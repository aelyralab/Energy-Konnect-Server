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

async function request(method, endpoint, { body, form, attempt = 1 } = {}) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${config.apiBase}${endpoint}`, {
    method,
    headers,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (!response.ok) {
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

export async function login() {
  if (!config.adminEmail || !config.adminPassword) {
    throw new Error(
      "INGEST_ADMIN_EMAIL / INGEST_ADMIN_PASSWORD are not set. See ingest/README.md.",
    );
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

export const createIssue = (payload) => request("POST", "/admin/issues", { body: payload });
export const listIssues = () => request("GET", "/admin/issues?limit=100");

/**
 * `?publish=false` leaves the article as a DRAFT with a pending version — the
 * state the CMS editor opens for review. Publishing is a separate, deliberate
 * action taken by a human, or by `load --publish` once they trust the output.
 */
export const createArticle = (payload, publish = false) =>
  request("POST", `/admin/articles?publish=${publish}`, { body: payload });

export const attachArticle = (issueId, payload) =>
  request("POST", `/admin/issues/${issueId}/articles`, { body: payload });

export const publishIssue = (issueId) => request("POST", `/admin/issues/${issueId}/publish`, {});
