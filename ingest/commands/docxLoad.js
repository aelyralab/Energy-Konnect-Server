/**
 * DOCX stage 4 — docx-load.
 *
 * One document, one Article. Creates the article through the existing admin
 * API and stops there.
 *
 * This is deliberately not a flag on commands/load.js. That loader exists to
 * reconstruct a magazine issue: upload the source PDF, create a
 * `Magazine`, create an article per piece, attach each with its section
 * label and display order. None of it applies here — there is no issue, no
 * attachment and no per-piece row — and threading a "no issue" branch through
 * it would put this track's shape inside the other track's loader.
 *
 * What that costs, stated plainly: with no issue row there is nowhere to hang
 * the source PDF, so the magazine archive page will not list this and there is
 * no PDF download link. The article carries the whole issue as blocks instead.
 *
 * Everything lands as DRAFT. Publishing is a human decision made in the CMS.
 *
 * Idempotent via out/ledger.json, written immediately after the create. Slugs
 * are generated server-side and `uniqueSlug` appends "-2" on collision, so a
 * second POST would quietly duplicate rather than fail — the ledger is the only
 * thing preventing that. Delete an entry to force a recreate.
 */
import fs from "node:fs";
import path from "node:path";
import config, { paths } from "../config.js";
import { issueKeyFor } from "./extract.js";
import { listDocx } from "../lib/docx.js";
import * as api from "../lib/api.js";
import { load as openLedger } from "../lib/ledger.js";
import { matchCategory } from "../lib/categories.js";
import { validatePayload } from "./validate.js";
import { versionContentSchema } from "../../src/modules/articleVersions/articleVersions.validation.js";

export default async function docxLoad({ only, dry }) {
  const documents = listDocx(config.docxDir).filter(
    (file) => !only || issueKeyFor(file).includes(only.toLowerCase()),
  );

  if (!documents.length) {
    console.error(`No .docx matched under ${config.docxDir}`);
    process.exitCode = 1;
    return;
  }

  const user = await api.login();
  console.log(`  authenticated as ${user.email} (${user.role})`);
  const categories = await api.listCategories();

  const ledger = openLedger();
  const problems = [];
  let created = 0;

  for (const source of documents) {
    const issueKey = issueKeyFor(source);
    const payloadPath = path.join(paths.structured(issueKey), "00.json");

    if (!fs.existsSync(payloadPath)) {
      console.log(`  -- ${issueKey}: nothing in structured/, run docx-media first`);
      continue;
    }

    const existing = ledger.article(issueKey, 0);
    if (existing) {
      console.log(`  -- ${issueKey}: already loaded as /${existing.slug}`);
      continue;
    }

    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));

    const { errors } = validatePayload(payload);
    if (errors.length) {
      problems.push(`${issueKey}: ${errors[0]}`);
      continue;
    }

    const category = matchCategory(payload.categoryName, categories);
    if (!category) {
      problems.push(
        `${issueKey}: category "${payload.categoryName}" does not exist — create it or edit the payload`,
      );
      continue;
    }

    const body = {
      title: payload.title,
      subtitle: payload.subtitle,
      summary: payload.summary,
      authorName: payload.authorName,
      categoryId: category.id,
      blocks: payload.blocks,
    };

    // The real schema, applied one line before the POST. If this passes, the
    // API's validate middleware will pass too.
    const check = versionContentSchema.safeParse(body);
    if (!check.success) {
      problems.push(`${issueKey}: ${check.error.issues[0].message}`);
      continue;
    }

    if (dry) {
      console.log(
        `  DRY create article "${payload.title.slice(0, 60)}" — ${payload.blocks.length} blocks -> ${category.name}, by ${payload.authorName}`,
      );
      continue;
    }

    const article = await api.createArticle(body, false);
    ledger.recordArticle(issueKey, 0, {
      id: article.id,
      slug: article.slug,
      title: payload.title,
    });
    created += 1;
    console.log(`  ok ${issueKey} -> /${article.slug}  (${payload.blocks.length} blocks)`);
  }

  console.log(
    dry
      ? "\n  --dry: nothing was written."
      : `\n  created ${created} article(s) (DRAFT — review and publish in the CMS)`,
  );

  if (problems.length) {
    console.log(`\n  ${problems.length} skipped:`);
    for (const problem of problems) console.log(`    - ${problem}`);
    process.exitCode = 1;
  }
}
