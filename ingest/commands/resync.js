/**
 * resync — push corrected payloads onto articles that are already loaded.
 *
 * `load` is create-only: it skips anything the ledger records, which is exactly
 * right for a migration that must never duplicate a row. But it leaves no way
 * to land a fix on articles that already exist, and fixes happen — a repair
 * rule in docx-blocks improves, a summary gets rewritten, a segment boundary
 * moves. Re-running the earlier stages then updates `out/structured/` and
 * nothing else, which is a quiet trap: the files look right and the database
 * still holds the old text.
 *
 * This closes that gap with the same PUT the CMS editor issues on save, so the
 * update goes through the same validation, the same version bump and the same
 * search-text rebuild as a human pressing the button.
 *
 * It refuses anything that is not a DRAFT. Editing a published article behind
 * the reviewer's back is not a migration concern, and the CMS is the right
 * place to do it deliberately.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import * as api from "../lib/api.js";
import { load as openLedger } from "../lib/ledger.js";
import { matchCategory } from "../lib/categories.js";
import { validatePayload } from "./validate.js";

/**
 * Whether the article already holds these blocks, so the PUT can be skipped.
 *
 * The API serves a block as `{ id, type, order, data }` and accepts it as
 * `{ blockType, content }`, and the served `data` for an image carries a
 * resolved `url` the payload never has. Comparing the two wire shapes directly
 * reports every article as changed, so both sides are reduced to type plus the
 * fields a payload actually sets.
 */
function sameBlocks(served, payload) {
  if (!Array.isArray(served) || served.length !== payload.length) return false;

  // Key order differs between the two — including inside a `reference` block's
  // nested items — so sort all the way down. `url` is dropped only at the top
  // level of a block's content, where it is the image URL the server resolves
  // and a payload never carries; inside a reference item, `url` is real data.
  const stable = (value, depth = 0) => {
    if (Array.isArray(value)) return value.map((item) => stable(item, depth + 1));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !(depth === 0 && key === "url"))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item, depth + 1)]),
    );
  };

  const reduce = (type, content) => JSON.stringify([type, stable(content ?? {})]);

  return served.every(
    (block, index) =>
      reduce(block.type ?? block.blockType, block.data ?? block.content) ===
      reduce(payload[index].blockType, payload[index].content),
  );
}

export default async function resync({ only, dry }) {
  const ledger = openLedger();
  const issueKeys = Object.keys(ledger.state.issues).filter(
    (key) => !only || key.includes(only.toLowerCase()),
  );

  if (!issueKeys.length) {
    console.error(only ? `No loaded issue matched "${only}"` : "Nothing is loaded yet");
    process.exitCode = 1;
    return;
  }

  const user = await api.login();
  console.log(`  authenticated as ${user.email} (${user.role})`);
  const categories = await api.listCategories();

  const problems = [];
  let updated = 0;
  let unchanged = 0;

  for (const issueKey of issueKeys) {
    const record = ledger.issue(issueKey);
    const dir = paths.structured(issueKey);
    if (!fs.existsSync(dir)) {
      console.log(`  -- ${issueKey}: no structured payloads on disk`);
      continue;
    }

    for (const file of fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      const payload = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      const known = record.articles?.[payload.articleIndex];
      if (!known) {
        console.log(`  -- ${issueKey} #${payload.articleIndex}: never loaded, use load`);
        continue;
      }

      const live = await api.getArticle(known.id);
      if (live.status !== "DRAFT") {
        problems.push(
          `${issueKey} #${payload.articleIndex} (${known.slug}) is ${live.status} — not touched`,
        );
        continue;
      }

      const { errors } = validatePayload(payload);
      if (errors.length) {
        problems.push(`${issueKey} #${payload.articleIndex}: ${errors[0]}`);
        continue;
      }

      const category = matchCategory(payload.categoryName, categories);
      if (!category) {
        problems.push(
          `${issueKey} #${payload.articleIndex}: category "${payload.categoryName}" does not exist`,
        );
        continue;
      }

      const version = live.pendingVersion ?? live.currentVersion;
      if (version && sameBlocks(version.blocks, payload.blocks)) {
        unchanged += 1;
        continue;
      }

      if (dry) {
        console.log(
          `  DRY update ${known.slug} -> ${payload.blocks.length} blocks (was ${version?.blocks?.length ?? "?"})`,
        );
        continue;
      }

      // `contentMode` is deliberately not sent: the schema defaults it to
      // BLOCKS, which is what a payload full of blocks means. That is also how
      // an article loaded by the PDF track converts — its body becomes the
      // blocks below, and it stops rendering as a document.
      //
      // The PDF itself is kept on the version even so. It costs one column,
      // the reader ignores it outside PDF mode, and it means the editor's
      // mode toggle can put the printed pages back without a re-upload.
      await api.updateArticle(known.id, {
        title: payload.title,
        summary: payload.summary,
        authorName: payload.authorName,
        categoryId: category.id,
        ...(version?.pdfMediaId
          ? { pdfMediaId: version.pdfMediaId, pdfPageCount: version.pdfPageCount ?? undefined }
          : {}),
        blocks: payload.blocks,
      });
      updated += 1;
      const from = version?.contentMode === "PDF" ? "PDF -> " : "";
      console.log(`  ok ${known.slug} -> ${from}${payload.blocks.length} blocks`);
    }
  }

  console.log(
    dry
      ? `\n  --dry: nothing was written. ${unchanged} article(s) already match.`
      : `\n  updated ${updated} article(s), ${unchanged} already matched`,
  );

  if (problems.length) {
    console.log(`\n  ${problems.length} skipped:`);
    for (const problem of problems) console.log(`    - ${problem}`);
    process.exitCode = 1;
  }
}
