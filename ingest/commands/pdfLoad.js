/**
 * PDF stage 4 — pdf-load.
 *
 * Turns the plans written by `split` into real rows, through the same admin API
 * the CMS uses. Per issue:
 *
 *   1. upload the whole issue PDF        -> the archive's download link
 *   2. POST /admin/magazines                -> the magazine
 *   3. upload each article's own PDF     -> pdfMediaId
 *   4. POST /admin/articles              -> a PDF-mode article, as DRAFT
 *   5. POST /admin/magazines/:id/articles   -> attached, with section and order
 *
 * The difference from commands/load.js is step 3 and the `contentMode: "PDF"`
 * in step 4: there are no blocks, and the article renders as the pages the
 * magazine actually printed. Everything else — the issue, the section labels,
 * the display order, the ledger, the DRAFT state — is identical, because from
 * the reader's side and the CMS's side a PDF article is an article.
 *
 * Idempotent through out/ledger.json, which is written after every create. An
 * issue can therefore mix both kinds: the five pieces of V1_I2 that were built
 * as blocks stay as they are, and this only adds what the ledger has no record
 * of. Delete an entry to force a recreate.
 */
import fs from "node:fs";
import path from "node:path";

import { paths } from "../config.js";
import * as api from "../lib/api.js";
import { load as openLedger } from "../lib/ledger.js";
import { matchCategory } from "../lib/categories.js";
import { pdfDir, planPath } from "./split.js";
import { versionContentSchema } from "../../src/modules/articleVersions/articleVersions.validation.js";

/**
 * Lands a corrected plan on an article that is already loaded.
 *
 * `pdf-load` is create-only, which is right for a migration — but the plan is
 * hand-editable and the classifier improves, and re-running the earlier stage
 * then updates plan.json and nothing else. That is a quiet trap: the file looks
 * right and the database still holds the old title.
 *
 * Uses the same PUT the CMS editor issues on save, so the update goes through
 * the same validation, version bump and search-text rebuild. Refuses anything
 * that is not a DRAFT — editing a published article behind the reviewer's back
 * is not a migration concern.
 *
 * @returns "updated", "unchanged", or a problem string.
 */
async function resyncArticle({ issueKey, article, known, categories, dry }) {
  // An issue can hold both kinds. The pilot's five block articles are in this
  // same ledger under this same plan's indices, and pushing a PDF payload at
  // one would silently convert it and throw its blocks away.
  if (known.contentMode !== "PDF") return null;

  const category = matchCategory(article.categoryName, categories);
  if (!category) {
    return `${issueKey} #${article.index}: category "${article.categoryName}" does not exist`;
  }

  const live = await api.getArticle(known.id);
  if (live.status !== "DRAFT") {
    return `${issueKey} #${article.index} (${known.slug}) is ${live.status} — not touched`;
  }

  const version = live.pendingVersion ?? live.currentVersion;
  const same =
    version &&
    version.title === article.title &&
    (version.summary ?? null) === (article.summary ?? null) &&
    // The owner serializer nests the byline as `author: { name, bio }`; the
    // payload sends it flat as `authorName`.
    version.author?.name === article.authorName &&
    version.categoryId === category.id &&
    version.pdfPageCount === article.pageCount;
  if (same) return "unchanged";

  if (dry) {
    console.log(
      `  DRY update /${known.slug}: ${version?.categoryId === category.id ? "" : `category -> ${category.name}, `}` +
        `title "${article.title.slice(0, 50)}"`,
    );
    return "unchanged";
  }

  await api.updateArticle(known.id, {
    title: article.title,
    summary: article.summary || undefined,
    authorName: article.authorName,
    categoryId: category.id,
    contentMode: "PDF",
    pdfMediaId: version.pdfMediaId,
    pdfPageCount: article.pageCount,
    blocks: [],
  });
  console.log(`  up ${issueKey} #${article.index} -> /${known.slug}`);
  return "updated";
}

export default async function pdfLoadCommand({ only, dry, resync }) {
  const manifestFiles = fs
    .readdirSync(paths.manifestDir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !only || name.includes(only.toLowerCase()))
    .sort();

  const plans = manifestFiles
    .map((file) => JSON.parse(fs.readFileSync(path.join(paths.manifestDir, file), "utf8")).issueKey)
    .filter((issueKey) => fs.existsSync(planPath(issueKey)))
    .map((issueKey) => JSON.parse(fs.readFileSync(planPath(issueKey), "utf8")));

  if (!plans.length) {
    console.error(`No plan found${only ? ` for "${only}"` : ""} — run \`split\` first.`);
    process.exitCode = 1;
    return;
  }

  const user = await api.login();
  console.log(`  authenticated as ${user.email} (${user.role})`);

  const categories = await api.listCategories();
  console.log(`  ${categories.length} categories available`);

  const ledger = openLedger();
  const problems = [];
  let createdIssues = 0;
  let createdArticles = 0;
  let resynced = 0;

  for (const plan of plans) {
    const { issueKey } = plan;

    if (plan.volumeNumber === null || plan.issueNumber === null) {
      problems.push(`${issueKey}: volumeNumber/issueNumber missing — fill them in the manifest`);
      continue;
    }

    // ---- 1. the whole issue, as the archive's download ----------------------
    let issuePdfId = ledger.media(issueKey, "pdf");
    if (!issuePdfId && !dry && fs.existsSync(plan.source)) {
      issuePdfId = (await api.uploadMedia(plan.source, "application/pdf")).id;
      ledger.recordMedia(issueKey, "pdf", issuePdfId);
    }

    // ---- 2. the issue -------------------------------------------------------
    let issueId = ledger.issue(issueKey)?.id ?? null;
    if (!issueId) {
      const body = {
        volumeNumber: plan.volumeNumber,
        issueNumber: plan.issueNumber,
        title: (plan.title || `Volume ${plan.volumeNumber} Issue ${plan.issueNumber}`).slice(
          0,
          300,
        ),
        period: plan.period ?? undefined,
        theme: plan.theme?.slice(0, 300) ?? undefined,
        pdfMediaId: issuePdfId ?? undefined,
      };
      if (dry) {
        console.log(`  DRY create issue vol ${body.volumeNumber} issue ${body.issueNumber}`);
      } else {
        issueId = (await api.createIssue(body)).id;
        ledger.recordIssue(issueKey, {
          id: issueId,
          volumeNumber: body.volumeNumber,
          issueNumber: body.issueNumber,
        });
        createdIssues += 1;
      }
    }

    // ---- 3, 4 & 5. the articles ---------------------------------------------
    let displayOrder = 0;
    for (const article of plan.articles) {
      const order = displayOrder;
      displayOrder += 1;

      const known = ledger.article(issueKey, article.index);
      if (known) {
        if (resync) {
          const outcome = await resyncArticle({ issueKey, article, known, categories, dry });
          if (outcome === "updated") resynced += 1;
          else if (outcome && outcome !== "unchanged") problems.push(outcome);
        }
        continue;
      }

      if (!article.title) {
        problems.push(
          `${issueKey} #${article.index}: no title — set one in ${planPath(issueKey)} (see out/pdf-review.md)`,
        );
        continue;
      }

      const category = matchCategory(article.categoryName, categories);
      if (!category) {
        problems.push(
          `${issueKey} #${article.index}: category "${article.categoryName}" does not exist — create it or edit the plan`,
        );
        continue;
      }

      const file = path.join(pdfDir(issueKey), article.file);
      if (!fs.existsSync(file)) {
        problems.push(
          `${issueKey} #${article.index}: ${article.file} not found — re-run \`split\``,
        );
        continue;
      }

      if (dry) {
        console.log(
          `  DRY create PDF article "${article.title.slice(0, 55)}" ` +
            `[${article.sectionLabel}] ${article.pageCount}pp -> ${category.name}, by ${article.authorName}`,
        );
        continue;
      }

      // The upload is recorded before the article is created, so a crash
      // between the two costs one orphaned media row rather than a second
      // copy of a 20-page PDF on the next run.
      const mediaKey = `article-pdf:${article.index}`;
      let pdfMediaId = ledger.media(issueKey, mediaKey);
      if (!pdfMediaId) {
        pdfMediaId = (await api.uploadMedia(file, "application/pdf")).id;
        ledger.recordMedia(issueKey, mediaKey, pdfMediaId);
      }

      const body = {
        title: article.title,
        summary: article.summary || undefined,
        authorName: article.authorName,
        categoryId: category.id,
        contentMode: "PDF",
        pdfMediaId,
        pdfPageCount: article.pageCount,
        blocks: [],
      };

      // The real schema, applied one line before the POST. If this passes, the
      // API's validate middleware will pass too.
      const check = versionContentSchema.safeParse(body);
      if (!check.success) {
        problems.push(`${issueKey} #${article.index}: ${check.error.issues[0].message}`);
        continue;
      }

      const created = await api.createArticle(body, false);
      ledger.recordArticle(issueKey, article.index, {
        id: created.id,
        slug: created.slug,
        title: article.title,
        contentMode: "PDF",
      });
      createdArticles += 1;

      await api.attachArticle(issueId, {
        articleId: created.id,
        sectionLabel: article.sectionLabel,
        displayOrder: order,
      });

      console.log(
        `  ok ${issueKey} #${article.index} -> /${created.slug}  (${article.pageCount}pp)`,
      );
    }
  }

  console.log(
    dry
      ? "\n  --dry: nothing was written."
      : `\n  created ${createdIssues} issue(s) and ${createdArticles} PDF article(s)` +
          (resync ? `, updated ${resynced}` : "") +
          " (all DRAFT — review, then `node ingest/run.js publish`)",
  );

  if (problems.length) {
    console.log(`\n  ${problems.length} item(s) skipped:`);
    for (const problem of problems) console.log(`    - ${problem}`);
    process.exitCode = 1;
  }
}
