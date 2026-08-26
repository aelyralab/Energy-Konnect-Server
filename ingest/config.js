/**
 * Ingest pipeline configuration.
 *
 * This directory is a one-off migration tool, not part of the running server.
 * It lives inside server/ deliberately: it imports the *real* zod block
 * schemas from ../src/utils/blockSchemas.js, so a payload that validates here
 * is a payload the API will accept. No schema copy, no drift.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

// Reuse the server's .env (DB, API port) without requiring a second copy.
for (const envFile of [path.join(serverRoot, ".env"), path.join(here, ".env")]) {
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    // Real environment variables always win over the file.
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

const num = (value, fallback) => (value === undefined ? fallback : Number(value));

export const config = {
  here,
  serverRoot,

  papersDir: process.env.INGEST_PAPERS_DIR ?? "E:/Aelyra Labs/Papers",
  outDir: process.env.INGEST_OUT_DIR ?? path.join(here, "out"),

  // pdftotext ships with poppler. On Windows it is usually only on Git Bash's
  // PATH, not Node's, so the resolver in lib/pdftext.js probes known locations.
  pdftotextBin: process.env.PDFTOTEXT_BIN ?? null,

  apiBase: process.env.INGEST_API_BASE ?? `http://localhost:${process.env.PORT ?? 4000}/api`,
  adminEmail: process.env.INGEST_ADMIN_EMAIL ?? "",
  adminPassword: process.env.INGEST_ADMIN_PASSWORD ?? "",

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  model: process.env.INGEST_MODEL ?? "claude-opus-5",
  effort: process.env.INGEST_EFFORT ?? "medium",
  maxTokens: num(process.env.INGEST_MAX_TOKENS, 16000),

  // Pages per model call. Keeps every response comfortably under maxTokens and
  // makes a retry cost one chunk, not one 30-page tutorial.
  chunkPages: num(process.env.INGEST_CHUNK_PAGES, 6),
  concurrency: num(process.env.INGEST_CONCURRENCY, 3),

  // Send the -layout rendering alongside the reading-order one. Costs roughly
  // 2x input tokens; it is the only rendering in which tables survive.
  sendLayout: process.env.INGEST_SEND_LAYOUT !== "0",
};

export const paths = {
  raw: (issueKey) => path.join(config.outDir, "raw", issueKey),
  manifest: (issueKey) => path.join(config.outDir, "manifests", `${issueKey}.json`),
  manifestDir: path.join(config.outDir, "manifests"),
  structured: (issueKey) => path.join(config.outDir, "structured", issueKey),
  ledger: path.join(config.outDir, "ledger.json"),
  report: path.join(config.outDir, "report.md"),
};

export default config;
