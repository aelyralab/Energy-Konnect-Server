/**
 * Stage 3 — structure.
 *
 * Manifest + raw pages in, ready-to-POST article payloads out. This is the only
 * stage that costs money, so it is aggressively resumable: each article is
 * written to its own file and skipped on re-run unless --force is passed. A
 * crash on article 90 of 155 loses nothing.
 *
 * Long articles are split into page chunks. Each chunk is one model call, which
 * keeps every response well inside max_tokens and makes a retry cost one chunk
 * rather than one 25-page tutorial.
 */
import fs from "node:fs";
import path from "node:path";
import config, { paths } from "../config.js";
import { structureChunk } from "../lib/structure.js";
import { stripFurniture, dehyphenate } from "../lib/clean.js";
import { CATEGORY_NAMES } from "../lib/categories.js";

/** Blocks handed to the next chunk so it can continue mid-thought. */
const TAIL_BLOCKS = 2;

function loadIssue(issueKey) {
  const rawDir = paths.raw(issueKey);
  const meta = JSON.parse(fs.readFileSync(path.join(rawDir, "_meta.json"), "utf8"));
  const furniture = new Set(meta.furniture);

  const read = (rendering, pageNumber) => {
    const file = path.join(rawDir, rendering, `page-${String(pageNumber).padStart(3, "0")}.txt`);
    // Furniture is stripped here rather than on disk, so the raw artifact stays
    // faithful to the PDF and stage 2 can still read the masthead.
    return dehyphenate(stripFurniture(fs.readFileSync(file, "utf8"), furniture));
  };

  return { meta, page: (n) => ({ flow: read("flow", n), layout: read("layout", n) }) };
}

function chunksFor(startPage, endPage, size) {
  const chunks = [];
  for (let start = startPage; start <= endPage; start += size) {
    chunks.push({ start, end: Math.min(start + size - 1, endPage) });
  }
  return chunks;
}

async function structureArticle({ issue, manifest, article, targetFile }) {
  const chunks = chunksFor(article.startPage, article.endPage, config.chunkPages);

  let head = null;
  const blocks = [];
  const notes = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  for (const [index, chunk] of chunks.entries()) {
    const pages = [];
    for (let n = chunk.start; n <= chunk.end; n += 1) pages.push(issue.page(n));

    const result = await structureChunk({
      pages,
      pageRange: chunk,
      isFirst: index === 0,
      tocTitle: article.title,
      categories: CATEGORY_NAMES,
      tail: blocks.slice(-TAIL_BLOCKS),
    });

    if (index === 0) head = result;
    blocks.push(...result.blocks);
    if (result.notes) notes.push(`p${chunk.start}-${chunk.end}: ${result.notes}`);
    for (const key of Object.keys(usage)) usage[key] += result.usage[key];
  }

  const payload = {
    issueKey: manifest.issueKey,
    articleIndex: article.index,
    sectionLabel: article.sectionLabel,
    sourcePages: `${article.startPage}-${article.endPage}`,
    tocTitle: article.title,

    // The shape POST /api/admin/articles expects, minus categoryId — resolved
    // from categoryName against the live taxonomy at load time.
    title: (head?.title || article.title).slice(0, 300),
    subtitle: head?.subtitle?.slice(0, 400) || undefined,
    summary: head?.summary?.slice(0, 2000) || undefined,
    authorName: (head?.authorName || "Energy Konnect Editorial").slice(0, 200),
    categoryName: head?.categoryName || null,
    blocks,

    notes,
    usage,
    structuredAt: new Date().toISOString(),
    model: config.model,
  };

  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function pooled(items, limit, worker) {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await worker(next[1], next[0]);
    }
  });
  await Promise.all(runners);
}

export default async function structure({ only, force, dry }) {
  const manifestFiles = fs
    .readdirSync(paths.manifestDir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !only || name.includes(only.toLowerCase()));

  const jobs = [];
  for (const file of manifestFiles) {
    const manifest = JSON.parse(fs.readFileSync(path.join(paths.manifestDir, file), "utf8"));
    for (const article of manifest.articles) {
      if (article.skip) continue;
      const targetFile = path.join(
        paths.structured(manifest.issueKey),
        `${String(article.index).padStart(2, "0")}.json`,
      );
      if (fs.existsSync(targetFile) && !force) continue;
      jobs.push({ manifest, article, targetFile });
    }
  }

  if (!jobs.length) {
    console.log("  nothing to do — every article is already structured (use --force to redo).");
    return;
  }

  const calls = jobs.reduce(
    (sum, job) =>
      sum + chunksFor(job.article.startPage, job.article.endPage, config.chunkPages).length,
    0,
  );
  console.log(
    `  ${jobs.length} articles / ${calls} model calls at ${config.model} (effort: ${config.effort}, ${config.chunkPages} pages per call)`,
  );
  if (dry) {
    console.log("  --dry: stopping before any API call.");
    return;
  }

  const issues = new Map();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let done = 0;
  const failures = [];

  await pooled(jobs, config.concurrency, async (job) => {
    const key = job.manifest.issueKey;
    if (!issues.has(key)) issues.set(key, loadIssue(key));

    try {
      const payload = await structureArticle({ ...job, issue: issues.get(key) });
      for (const field of Object.keys(totals)) totals[field] += payload.usage[field];
      done += 1;
      console.log(
        `  ok [${done}/${jobs.length}] ${key} #${job.article.index} "${payload.title.slice(0, 60)}" — ${payload.blocks.length} blocks${payload.notes.length ? ` (${payload.notes.length} notes)` : ""}`,
      );
    } catch (error) {
      failures.push({ key, index: job.article.index, message: error.message });
      console.error(`  !! ${key} #${job.article.index}: ${error.message}`);
    }
  });

  console.log(
    `\n  tokens: ${totals.input.toLocaleString()} in / ${totals.output.toLocaleString()} out (${totals.cacheRead.toLocaleString()} cached reads)`,
  );
  if (failures.length) {
    console.log(`  ${failures.length} article(s) failed — re-run to retry just those.`);
    process.exitCode = 1;
  }
}
