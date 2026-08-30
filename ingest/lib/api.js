/**
 * Thin client for the admin API surface the loader needs.
 *
 * Every endpoint used here already exists — nothing in the server was added or
 * changed for this pipeline. Responses are wrapped as `{ data }` by
 * utils/respond.js, which is unwrapped here so callers see plain records.
 */
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";

let accessToken = null;

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Where the access token is parked between commands.
 *
 * Every stage is its own `node ingest/run.js` process, so an in-memory token
 * dies with it and each command logs in again. POST /auth/login allows 10
 * attempts per 15 minutes per email (auth.routes.js), and loading an issue
 * costs two authenticated commands — so the fifth issue of a run gets a 429 and
 * the migration stops halfway. Caching the token to disk keeps a whole run on
 * one login.
 */
const sessionFile = path.join(config.outDir, ".session.json");

/** The token's own `exp` claim, so the cache expires exactly when it does. */
function expiryOf(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function readSession() {
  try {
    const cached = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    // A minute of headroom: a long upload must not start on a token that
    // expires while it is in flight.
    if (cached.email !== config.adminEmail) return null;
    if (expiryOf(cached.accessToken) < Date.now() + 60_000) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), "utf8");
  } catch {
    // A cache that cannot be written is not a reason to fail the command.
  }
}

async function request(method, endpoint, { body, form, attempt = 1 } = {}) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${config.apiBase}${endpoint}`, {
      method,
      headers,
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
  } catch (error) {
    // `fetch` throws rather than returning a status when the connection itself
    // fails — a dev server restarting mid-run, a socket dropped under a long
    // upload. A load is 150+ requests over several minutes, so one of those
    // should cost a retry, not the whole run.
    if (attempt > 4) throw error;
    await sleep(500 * 2 ** attempt);
    return request(method, endpoint, { body, form, attempt: attempt + 1 });
  }

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (!response.ok) {
    // A cached token that the server no longer accepts — restarted with a new
    // JWT secret, or expired between the check and the call. Worth exactly one
    // fresh login; `endpoint` guards against recursing through login itself.
    if (response.status === 401 && endpoint !== "/auth/login" && attempt === 1) {
      await login({ force: true });
      return request(method, endpoint, { body, form, attempt: attempt + 1 });
    }
    if (RETRYABLE.has(response.status) && attempt <= 4) {
      await sleep(500 * 2 ** attempt);
      return request(method, endpoint, { body, form, attempt: attempt + 1 });
    }
    const error = parsed.error ?? {};
    const detail = error.details ? ` ${JSON.stringify(error.details)}` : "";
    throw new Error(
      `${method} ${endpoint} -> ${response.status} ${error.code ?? ""} ${error.message ?? text}${detail}`.trim(),
    );
  }

  return parsed.data;
}

export async function login({ force = false } = {}) {
  if (!config.adminEmail || !config.adminPassword) {
    throw new Error(
      "INGEST_ADMIN_EMAIL / INGEST_ADMIN_PASSWORD are not set. See ingest/README.md.",
    );
  }

  if (!force) {
    const cached = readSession();
    if (cached) {
      accessToken = cached.accessToken;
      return cached.user;
    }
  }

  const session = await request("POST", "/auth/login", {
    body: { email: config.adminEmail, password: config.adminPassword },
  });
  if (session.user.role !== "ADMIN") {
    throw new Error(
      `${config.adminEmail} is ${session.user.role}, not ADMIN — the loader needs admin routes.`,
    );
  }
  accessToken = session.accessToken;
  writeSession({ email: config.adminEmail, accessToken, user: session.user });
  return session.user;
}

export const listCategories = () => request("GET", "/categories");

/**
 * POST /api/media. Node 24 has FormData/Blob natively, so no multipart library
 * is needed. Caps are enforced server-side (10MB images, 25MB PDFs).
 */
export async function uploadMedia(filePath, mimeType) {
  const form = new FormData();
  const buffer = fs.readFileSync(filePath);
  form.append("file", new Blob([buffer], { type: mimeType }), path.basename(filePath));
  return request("POST", "/media", { form });
}

// Function/parameter names here deliberately keep the tool's own "issue"
// vocabulary — only the API paths moved to /admin/magazines (server-side
// rename from "publication issue" to "magazine"). Not worth threading a
// second rename through this whole one-off migration tool.
export const createIssue = (payload) => request("POST", "/admin/magazines", { body: payload });
export const updateIssue = (issueId, payload) =>
  request("PUT", `/admin/magazines/${issueId}`, { body: payload });
export const listIssues = () => request("GET", "/admin/magazines?limit=100");

/**
 * `?publish=false` leaves the article as a DRAFT with a pending version — the
 * state the CMS editor opens for review. Publishing is a separate, deliberate
 * action taken by a human, or by `load --publish` once they trust the output.
 */
export const createArticle = (payload, publish = false) =>
  request("POST", `/admin/articles?publish=${publish}`, { body: payload });

/**
 * The same save the CMS editor issues. `load` is create-only and skips whatever
 * the ledger already records, which is right for a migration — but it leaves no
 * way to land a fix to the block builder on rows that already exist. This is
 * that way, and it goes through the same validation and versioning as a human
 * pressing save.
 */
export const updateArticle = (articleId, payload) =>
  request("PUT", `/admin/articles/${articleId}`, { body: payload });

export const getArticle = (articleId) => request("GET", `/admin/articles/${articleId}`);

/**
 * §31's edit-and-republish. The only way back for an article that was
 * published and then unpublished: `POST /publish` needs a *pending* version and
 * unpublishing leaves none, so the content has to be re-submitted.
 */
export const updatePublishedContent = (articleId, payload) =>
  request("PUT", `/admin/articles/${articleId}/published-content`, { body: payload });

export const attachArticle = (issueId, payload) =>
  request("POST", `/admin/magazines/${issueId}/articles`, { body: payload });

export const publishIssue = (issueId) =>
  request("POST", `/admin/magazines/${issueId}/publish`, {});

/**
 * Makes a loaded article public. An article's status and its issue's status are
 * independent (§21, rule 18), so publishing the issue is not enough on its own
 * and neither is this — commands/publish.js does both.
 */
export const publishArticle = (articleId) =>
  request("POST", `/admin/articles/${articleId}/publish`, {});
