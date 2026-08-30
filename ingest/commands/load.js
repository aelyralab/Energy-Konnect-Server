/**
 * Stage 5 — load.
 *
 * Structured payloads in, real rows out, via the existing admin API. Nothing
 * here bypasses the application: the same endpoints the CMS uses do the writing,
 * so every invariant the service layer enforces (slug uniqueness, version
 * creation, search text, review actions) is enforced here too.
 *
 * Per issue:
 *   1. upload the source PDF   -> pdfMediaId
 *   2. POST /admin/magazines      -> issueId
 *   3. POST /admin/articles    -> articleId, once per article, as DRAFT
 *   4. POST /admin/magazines/:id/articles to attach with sectionLabel + order
 *
 * Everything is recorded in out/ledger.json as it happens, and re-running skips
 * what already exists. The issue is left unpublished: publishing is a human
 * decision made in the CMS after review.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import * as api from "../lib/api.js";
import { load as openLedger } from "../lib/ledger.js";
import { matchCategory } from "../lib/categories.js";
import { validatePayload } from "./validate.js";
import { versionContentSchema } from "../../src/modules/articleVersions/articleVersions.validation.js";

function readStructured(issueKey) {
  const dir = paths.structured(issueKey);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

export default async function loadCommand({ only, dry }) {
  const manifestFiles = fs
    .readdirSync(paths.manifestDir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !only || name.includes(only.toLowerCase()));

  const user = await api.login();
  console.log(`  authenticated as ${user.email} (${user.role})`);

  const categories = await api.listCategories();
  console.log(`  ${categories.length} categories available`);

  const ledger = openLedger();
  const problems = [];
  let createdArticles = 0;
  let createdIssues = 0;

  for (const file of manifestFiles) {
    const manifest = JSON.parse(fs.readFileSync(path.join(paths.manifestDir, file), "utf8"));
    const { issueKey } = manifest;
    const payloads = readStructured(issueKey);

    if (!payloads.length) {
      console.log(`  -- ${issueKey}: nothing structured, skipping`);
      continue;
    }
    if (manifest.volumeNumber === null || manifest.issueNumber === null) {
      problems.push(`${issueKey}: volumeNumber/issueNumber missing — fill them in the manifest`);
      continue;
    }

    // ---- 1. the source PDF as a downloadable asset -------------------------
    let pdfMediaId = ledger.media(issueKey, "pdf");
    if (manifest.attachPdf && !pdfMediaId && !dry) {
      pdfMediaId = (await api.uploadMedia(manifest.source, "application/pdf")).id;
      ledger.recordMedia(issueKey, "pdf", pdfMediaId);
    }

    // ---- 2. the issue ------------------------------------------------------
    let issueId = ledger.issue(issueKey)?.id ?? null;
    if (!issueId) {
      const body = {
        volumeNumber: manifest.volumeNumber,
        issueNumber: manifest.issueNumber,
        title: (
          manifest.title || `Volume ${manifest.volumeNumber} Issue ${manifest.issueNumber}`
        ).slice(0, 300),
        period: manifest.period ?? undefined,
        theme: manifest.theme?.slice(0, 300) ?? undefined,
        pdfMediaId: pdfMediaId ?? undefined,
      };
      if (dry) {
        console.log(
          `  DRY create issue vol ${body.volumeNumber} issue ${body.issueNumber} "${body.title.slice(0, 50)}"`,
        );
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

    // ---- 3 & 4. articles, then attachment ----------------------------------
    let displayOrder = 0;
    for (const payload of payloads) {
      const alreadyThere = ledger.article(issueKey, payload.articleIndex);
      if (alreadyThere) {
        displayOrder += 1;
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
          `${issueKey} #${payload.articleIndex}: category "${payload.categoryName}" does not exist — create it or edit the payload`,
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
        problems.push(`${issueKey} #${payload.articleIndex}: ${check.error.issues[0].message}`);
        continue;
      }

      if (dry) {
        console.log(
          `  DRY create article "${payload.title.slice(0, 55)}" [${payload.sectionLabel}] ${payload.blocks.length} blocks -> ${category.name}`,
        );
        displayOrder += 1;
        continue;
      }

      const article = await api.createArticle(body, false);
      ledger.recordArticle(issueKey, payload.articleIndex, {
        id: article.id,
        slug: article.slug,
        title: payload.title,
      });
      createdArticles += 1;

      await api.attachArticle(issueId, {
        articleId: article.id,
        sectionLabel: payload.sectionLabel,
        displayOrder,
      });
      displayOrder += 1;

      console.log(`  ok ${issueKey} #${payload.articleIndex} -> /${article.slug}`);
    }
  }

  console.log(
    dry
      ? "\n  --dry: nothing was written."
      : `\n  created ${createdIssues} issues and ${createdArticles} articles (all DRAFT — review and publish in the CMS)`,
  );

  if (problems.length) {
    console.log(`\n  ${problems.length} item(s) skipped:`);
    for (const problem of problems) console.log(`    - ${problem}`);
    process.exitCode = 1;
  }
}
