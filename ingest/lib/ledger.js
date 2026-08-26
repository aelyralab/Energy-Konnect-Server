/**
 * Idempotency for the loader.
 *
 * Article slugs are generated server-side from the title (utils/slug.js), and
 * `uniqueSlug` appends "-2" on collision — so re-POSTing the same article does
 * not fail, it silently creates a duplicate. Remembering what was created is
 * the only way to make the load safely resumable.
 *
 * Written after every single create, not at the end, so a crash mid-run leaves
 * an accurate record.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";

function read() {
  if (!fs.existsSync(paths.ledger)) return { issues: {} };
  return JSON.parse(fs.readFileSync(paths.ledger, "utf8"));
}

function write(state) {
  fs.mkdirSync(path.dirname(paths.ledger), { recursive: true });
  fs.writeFileSync(paths.ledger, JSON.stringify(state, null, 2), "utf8");
}

export function load() {
  const state = read();
  return {
    state,

    issue(issueKey) {
      return state.issues[issueKey] ?? null;
    },

    recordIssue(issueKey, record) {
      state.issues[issueKey] = { ...(state.issues[issueKey] ?? { articles: {} }), ...record };
      write(state);
    },

    article(issueKey, articleIndex) {
      return state.issues[issueKey]?.articles?.[articleIndex] ?? null;
    },

    recordArticle(issueKey, articleIndex, record) {
      const issue = (state.issues[issueKey] ??= { articles: {} });
      (issue.articles ??= {})[articleIndex] = record;
      write(state);
    },

    recordMedia(issueKey, kind, mediaId) {
      const issue = (state.issues[issueKey] ??= { articles: {} });
      (issue.media ??= {})[kind] = mediaId;
      write(state);
    },

    media(issueKey, kind) {
      return state.issues[issueKey]?.media?.[kind] ?? null;
    },
  };
}

export default load;
