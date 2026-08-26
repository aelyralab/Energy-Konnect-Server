/**
 * Stage 2 — segment.
 *
 * Raw pages in, a reviewable manifest out. This is the one stage a human is
 * expected to look at: 21 small JSON files describing what the pipeline
 * believes each issue contains, before any money or database writes are spent
 * on that belief.
 *
 * Every manifest carries `confidence` and `warnings`. "review" does not mean
 * broken — it means the three signals in lib/toc.js did not fully agree.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { parseCover, parseToc, folioOffset, resolveRanges } from "../lib/toc.js";

/** Boilerplate that is part of the magazine, not an article worth publishing. */
const SKIP_BY_DEFAULT = /^(about energy konnect|about)$/i;

/** Longest a single article may run before the segmentation is treated as suspect. */
const MAX_ARTICLE_PAGES = 25;

function readPages(issueKey, rendering) {
  const dir = path.join(paths.raw(issueKey), rendering);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"));
}

export function buildManifest(issueKey) {
  const meta = JSON.parse(fs.readFileSync(path.join(paths.raw(issueKey), "_meta.json"), "utf8"));
  const flow = readPages(issueKey, "flow");
  const layout = readPages(issueKey, "layout");

  const warnings = [];

  // The TOC is a designed, aligned block — it survives -layout and is mangled
  // by reading-order flow, so parse it from the layout rendering.
  const cover = parseCover(layout, meta.fileName, meta.volumeFolder);
  const { entries, tocPageIndex, hadMarker } = parseToc(layout);
  const folio = folioOffset(layout);

  warnings.push(...cover.notes);
  if (cover.volumeNumber === null) warnings.push("volumeNumber not detected");
  if (cover.issueNumber === null) warnings.push("issueNumber not detected — set it by hand");
  if (cover.period === null) warnings.push("period not detected");
  if (tocPageIndex === null) warnings.push("no contents listing found — list articles by hand");
  else if (!hadMarker)
    warnings.push(`contents listing found on page ${tocPageIndex + 1} with no heading`);
  if (!entries.length) warnings.push("no TOC entries parsed — articles must be listed by hand");
  if (folio.observed < 5) {
    warnings.push(`only ${folio.observed} printed page numbers found — page offset is a guess`);
  } else if (folio.agreement < 0.7) {
    warnings.push(
      `printed page numbers agree on only ${Math.round(folio.agreement * 100)}% of the ${folio.observed} pages that showed one (offset ${folio.offset})`,
    );
  }

  const ranges = resolveRanges(entries, folio.offset, meta.pageCount);
  if (ranges.length && ranges.length < entries.length) {
    warnings.push(`${entries.length - ranges.length} TOC entries fell outside the page range`);
  }

  const articles = ranges.map((range, index) => {
    // The final TOC entry inherits every remaining page, which sweeps the back
    // matter ("Power & Energy, June 2020") into a 49-page "article". Cap it and
    // say so rather than sending 49 pages to the model as one piece.
    const isLast = index === ranges.length - 1;
    const capped = isLast && range.endPage - range.startPage + 1 > MAX_ARTICLE_PAGES;
    const endPage = capped ? range.startPage + MAX_ARTICLE_PAGES - 1 : range.endPage;

    return {
      index,
      title: range.title,
      sectionLabel: range.sectionLabel,
      startPage: range.startPage,
      endPage,
      pages: endPage - range.startPage + 1,
      cappedFrom: capped ? range.endPage : null,
      // Set to true to exclude an entry without deleting it — keeps the manifest
      // a faithful record of what the TOC actually said.
      skip: SKIP_BY_DEFAULT.test(range.sectionLabel) || SKIP_BY_DEFAULT.test(range.title),
    };
  });

  for (const article of articles) {
    if (article.cappedFrom) {
      warnings.push(
        `"${article.title}" ran to page ${article.cappedFrom} (back matter?) — capped at ${article.endPage}`,
      );
    } else if (!article.skip && article.pages > MAX_ARTICLE_PAGES) {
      warnings.push(`"${article.title}" spans ${article.pages} pages — check its end page`);
    }
  }

  return {
    issueKey,
    source: meta.sourcePath,
    pageCount: meta.pageCount,
    volumeNumber: cover.volumeNumber,
    issueNumber: cover.issueNumber,
    title: cover.coverTitle,
    period: cover.period,
    theme: cover.coverTitle,
    folioOffset: folio.offset,
    folioAgreement: Number(folio.agreement.toFixed(2)),
    confidence: warnings.length === 0 ? "ok" : "review",
    warnings,
    articles,
    // Filled in by later stages; kept here so one file describes one issue.
    coverImage: null,
    attachPdf: true,
    _flowPages: flow.length,
    _layoutPages: layout.length,
  };
}

export default async function segment({ only, force }) {
  const rawDir = path.join(paths.manifestDir, "..", "raw");
  if (!fs.existsSync(rawDir)) {
    console.error("Nothing extracted yet — run `node ingest/run.js extract` first.");
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(paths.manifestDir, { recursive: true });
  const issueKeys = fs
    .readdirSync(rawDir)
    .filter((key) => !only || key.includes(only.toLowerCase()));

  let review = 0;
  for (const issueKey of issueKeys) {
    const target = paths.manifest(issueKey);
    if (fs.existsSync(target) && !force) {
      console.log(`  -- ${issueKey}  (manifest exists, use --force to regenerate)`);
      continue;
    }

    const manifest = buildManifest(issueKey);
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2), "utf8");

    const kept = manifest.articles.filter((a) => !a.skip).length;
    const flag = manifest.confidence === "ok" ? "ok" : "!!";
    if (manifest.confidence !== "ok") review += 1;
    console.log(
      `  ${flag} ${issueKey}  vol ${manifest.volumeNumber ?? "?"} issue ${manifest.issueNumber ?? "?"}  ${kept} articles  ${manifest.warnings.length} warnings`,
    );
    for (const warning of manifest.warnings) console.log(`       - ${warning}`);
  }

  if (review) {
    console.log(
      `\n${review} manifest(s) need review. Edit them in ${paths.manifestDir} before running \`structure\`.`,
    );
  }
}
