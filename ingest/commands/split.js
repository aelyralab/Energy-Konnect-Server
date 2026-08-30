/**
 * PDF stage 3 — split.
 *
 * A magazine is not an article. Each issue PDF holds five to eleven separate
 * pieces, and the reader is looking for one of them, not for a 60-page scan to
 * scroll through. This stage cuts every issue into one PDF per article using
 * the page ranges stage 2 already resolved, and writes down what each of those
 * articles should be called, who wrote it and where it belongs.
 *
 * It writes two things per issue:
 *
 *   out/pdfs/<issueKey>/NN.pdf   the article, as its own document
 *   out/pdfs/<issueKey>/plan.json  what `pdf-load` will create from it
 *
 * plan.json is meant to be read and edited. Titles come from two unreliable
 * sources (see lib/titles.js) and categories from keyword scoring, so the plan
 * is a proposal, not a result — out/pdf-review.md lists exactly which entries
 * the pipeline is unsure about so that reviewing 21 issues does not mean
 * reading 154 articles. Re-running leaves an existing plan alone; `--force`
 * regenerates it and discards any edits.
 *
 * Nothing here touches the database or the network.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

import config, { paths } from "../config.js";
import { readFrontPage } from "../lib/frontpage.js";
import { chooseTitle, chooseAuthor, expandLigatures } from "../lib/titles.js";
import { classify } from "../lib/classify.js";

/** POST /api/media rejects anything larger; see modules/media/media.service.js. */
const MAX_PDF_BYTES = 25 * 1024 * 1024;

export const pdfDir = (issueKey) => path.join(config.outDir, "pdfs", issueKey);
export const planPath = (issueKey) => path.join(pdfDir(issueKey), "plan.json");
const reviewPath = path.join(config.outDir, "pdf-review.md");

/** The article's own text, for keyword classification only. */
function readBody(issueKey, startPage, endPage) {
  const parts = [];
  for (let page = startPage; page <= Math.min(endPage, startPage + 3); page += 1) {
    const file = path.join(
      paths.raw(issueKey),
      "flow",
      `page-${String(page).padStart(3, "0")}.txt`,
    );
    if (fs.existsSync(file)) parts.push(fs.readFileSync(file, "utf8"));
  }
  return expandLigatures(parts.join("\n"));
}

/**
 * A standfirst for the article, taken from its own opening paragraph.
 *
 * Optional everywhere else, but it earns its place here: `search_vector` gives
 * the summary weight B and never sees an article's body at all — blocks are not
 * indexed, and a PDF certainly is not. Without this, a PDF article is findable
 * only by its title and taxonomy.
 *
 * Only clean prose qualifies. The extraction is `-raw` reading order, which on
 * a two-column page can still interleave, so anything that does not read like a
 * sentence is left out rather than guessed at.
 */
function summarise(bodyText) {
  const paragraph = bodyText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 60 && /^[A-Z"'(]/.test(line) && /[a-z]{4}/.test(line))
    .slice(0, 4)
    .join(" ");

  if (paragraph.length < 120) return undefined;

  // Cut on a sentence end so the standfirst does not stop mid-clause.
  const window = paragraph.slice(0, 420);
  const lastStop = window.lastIndexOf(". ");
  const text = lastStop > 140 ? window.slice(0, lastStop + 1) : `${window.trim()}…`;

  // A run with almost no spaces, or littered with digits, is a table or a
  // figure caption that happened to start with a capital.
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters / text.length < 0.7) return undefined;

  return text.trim();
}

/**
 * Derives the article list by reading every page, instead of the contents page.
 *
 * The contents page is the better source when it parses, which is why it is the
 * default. On the issues where it does not — Volume 2's are set as two
 * interleaving columns — it does not merely scramble titles, it loses articles:
 * `micro grid` resolves to two entries for a 62-page magazine, one of them 44
 * pages long.
 *
 * Every article opens the same way, though, and lib/frontpage.js already knows
 * how to read that: a section strap, a headline, usually a byline. Walking the
 * pages and taking each of those as a boundary recovers the issue's real shape
 * from the pages themselves. Opt in with `--rescan`, per issue.
 */
function scanOpenings(issueKey, pageCount, manifest) {
  const openings = [];

  for (let page = 2; page <= pageCount; page += 1) {
    const front = readFrontPage(issueKey, page);
    const strap = front.sectionLabel;
    const headline = front.headline && front.headline.length >= 15 ? front.headline : null;

    // A strap is the magazine's own "an article starts here". A confident
    // headline says the same thing on the issues that drop the strap.
    if (!strap && !(headline && front.confident)) continue;
    // Front matter, already excluded from every other path.
    if (strap === "About") continue;
    // A page carrying neither a strap nor a readable headline is a continuation
    // that happened to trip the reader.
    if (!strap && !headline) continue;

    openings.push({ page, sectionLabel: strap, headline, author: front.author });
  }

  return openings.map((opening, index) => ({
    index,
    title: opening.headline ?? opening.sectionLabel ?? null,
    sectionLabel: opening.sectionLabel ?? "Feature Article",
    startPage: opening.page,
    endPage: (openings[index + 1]?.page ?? pageCount + 1) - 1,
    cappedFrom: null,
    skip: false,
    _period: manifest.period,
  }));
}

/** Builds the proposed article record for one manifest entry. */
function planArticle(manifest, entry) {
  const front = readFrontPage(manifest.issueKey, entry.startPage);

  // The strap printed above the headline is the magazine's own statement of
  // the section, and beats the contents page's guess wherever it was found.
  const sectionLabel = front.sectionLabel ?? entry.sectionLabel ?? "Feature Article";

  const chosen = chooseTitle({
    tocTitle: entry.title,
    front,
    sectionLabel,
    period: manifest.period,
  });

  // Stage 2 caps the last article of an issue at 25 pages, because that entry
  // inherits every unlisted page and a 49-page chunk is a bad unit of work to
  // send a model. That cost does not exist here — nothing reads the article —
  // and truncating it would drop real pages out of the archive, so the full
  // range is restored.
  const endPage = entry.cappedFrom ?? entry.endPage;

  const body = readBody(manifest.issueKey, entry.startPage, endPage);
  const category = classify(chosen.title, body);

  const warnings = [];
  const notes = [];

  if (chosen.needsReview) warnings.push(chosen.reason);
  if (!category.confident) {
    notes.push(`category "${category.categoryName}" was a close call — no decisive keyword`);
  }
  if (entry.cappedFrom) {
    notes.push(
      `runs to the end of the issue (${endPage - entry.startPage + 1} pages) — the contents page listed nothing after it`,
    );
  }

  return {
    index: entry.index,
    title: chosen.title,
    titleSource: chosen.source,
    summary: summarise(body),
    authorName: chooseAuthor(front),
    authorSource: front.author ? "byline" : "house",
    sectionLabel,
    categoryName: category.categoryName,
    startPage: entry.startPage,
    endPage,
    pageCount: endPage - entry.startPage + 1,
    file: `${String(entry.index).padStart(2, "0")}.pdf`,
    warnings,
    notes,
  };
}

/**
 * Folds contents entries that turned out not to be articles into the piece
 * they continue.
 *
 * When a two-column contents page interleaves, it does not only scramble
 * titles — it invents entries. Each phantom points at pages that belong to the
 * article listed before it, and those pages open mid-sentence with no strap,
 * no headline and no byline, which is exactly the state in which both title
 * sources come back empty.
 *
 * Dropping them would take real pages out of the archive, so the pages go back
 * where they came from and the merge is recorded on the surviving article. An
 * untitled *first* entry has nowhere to go and is left for a human.
 */
function mergeOrphans(articles) {
  const queue = [...articles];
  const kept = [];

  // A stray at the very front has nothing behind it to rejoin, so it folds
  // forward instead: an issue's first listed entry is sometimes the opening
  // spread of the article that follows it.
  while (queue.length > 1 && !queue[0].title) {
    const orphan = queue.shift();
    const next = queue[0];
    next.startPage = Math.min(next.startPage, orphan.startPage);
    next.pageCount = next.endPage - next.startPage + 1;
    next.notes.push(
      `pages ${orphan.startPage}–${orphan.endPage} opened the issue as a separate entry with no ` +
        "recoverable title, and were folded forward into this article",
    );
  }

  for (const article of queue) {
    const previous = kept.at(-1);
    const reason = previous && strayReason(previous, article);

    if (!previous || !reason) {
      kept.push(article);
      continue;
    }

    previous.endPage = Math.max(previous.endPage, article.endPage);
    previous.pageCount = previous.endPage - previous.startPage + 1;
    previous.notes.push(
      `pages ${article.startPage}–${article.endPage} were listed as a separate entry (${reason}) ` +
        "and folded back into this article",
    );
  }

  // Checked after merging, since merging is one of the ways an article gets
  // this long. The final entry of an issue is expected to be outsized — it
  // inherits the back matter, which no contents page lists — so that one is a
  // note. Anywhere else it means an entry went missing.
  for (const [position, article] of kept.entries()) {
    if (article.pageCount <= 40) continue;
    const message = `${article.pageCount} pages — longer than any article in this archive really is`;
    if (position === kept.length - 1) {
      article.notes.push(`${message}; it runs to the end of the issue and carries the back matter`);
    } else {
      article.warnings.push(`${message}, so the contents listing has probably lost an entry here`);
    }
  }

  return kept;
}

/** Why an entry is not its own article, or null if it is one. */
function strayReason(previous, article) {
  if (!article.title) return "no recoverable title, reads as a continuation";
  if (article.title.toLowerCase() === previous.title?.toLowerCase()) {
    return "same title as the entry before it";
  }
  // Two entries claiming the same opening page is the contents listing
  // contradicting itself; the pages can only belong to one article.
  if (article.startPage <= previous.startPage) return "starts on a page already claimed";
  return null;
}

/** Writes one article's pages out as a standalone PDF. */
async function cutPages(source, target, startPage, endPage) {
  const copy = await PDFDocument.create();
  const indices = [];
  for (let page = startPage; page <= endPage; page += 1) indices.push(page - 1);

  const pages = await copy.copyPages(source, indices);
  for (const page of pages) copy.addPage(page);

  const bytes = await copy.save();
  fs.writeFileSync(target, bytes);
  return bytes.length;
}

/**
 * Page 1 is the issue cover. Two contents pages list it as though it were the
 * first article — it carries the cover line, which reads like a title — and
 * loading it would put a one-page duplicate of the issue's own name at the top
 * of that issue. The cover is not lost: the whole-issue PDF is attached to the
 * `Magazine` itself.
 */
const isCover = (entry) => entry.startPage <= 1 && entry.endPage <= 1;

export default async function splitCommand({ only, force, dry, rescan }) {
  const manifestFiles = fs
    .readdirSync(paths.manifestDir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !only || name.includes(only.toLowerCase()))
    .sort();

  if (!manifestFiles.length) {
    console.error(`No manifest matched${only ? ` "${only}"` : ""} under ${paths.manifestDir}`);
    process.exitCode = 1;
    return;
  }

  const report = [];
  let cutCount = 0;
  let flagged = 0;
  let oversized = 0;

  for (const file of manifestFiles) {
    const manifest = JSON.parse(fs.readFileSync(path.join(paths.manifestDir, file), "utf8"));
    const { issueKey } = manifest;
    const entries = rescan
      ? scanOpenings(issueKey, manifest.pageCount, manifest)
      : manifest.articles.filter((entry) => !entry.skip && !isCover(entry));
    const covers = rescan ? 0 : manifest.articles.filter(isCover).length;

    if (!entries.length) {
      console.log(`  -- ${issueKey}: no articles in the manifest`);
      continue;
    }

    const directory = pdfDir(issueKey);
    const existingPlan = fs.existsSync(planPath(issueKey)) && !force;

    const plan = existingPlan
      ? JSON.parse(fs.readFileSync(planPath(issueKey), "utf8"))
      : {
          issueKey,
          volumeNumber: manifest.volumeNumber,
          issueNumber: manifest.issueNumber,
          title: manifest.title,
          period: manifest.period,
          theme: manifest.theme,
          source: manifest.source,
          issuePageCount: manifest.pageCount,
          coversDropped: covers,
          articles: mergeOrphans(entries.map((entry) => planArticle(manifest, entry))),
        };

    if (dry) {
      for (const article of plan.articles) {
        console.log(
          `  DRY ${issueKey} #${article.index} p${article.startPage}-${article.endPage} ` +
            `[${article.sectionLabel}] ${article.categoryName} — ` +
            `"${(article.title ?? "(no title)").slice(0, 60)}" by ${article.authorName}`,
        );
      }
      report.push({ issueKey, plan });
      continue;
    }

    fs.mkdirSync(directory, { recursive: true });
    if (!existingPlan) {
      fs.writeFileSync(planPath(issueKey), JSON.stringify(plan, null, 2), "utf8");

      // Regenerating can drop an entry (see mergeOrphans) or move its range.
      // Leaving the old cut behind would let `pdf-load` upload a PDF the plan
      // no longer describes.
      const wanted = new Set(plan.articles.map((article) => article.file));
      for (const name of fs.readdirSync(directory)) {
        if (name.endsWith(".pdf") && !wanted.has(name)) fs.rmSync(path.join(directory, name));
      }
    }

    // One parse of the issue, reused for every cut out of it.
    const needsCutting = plan.articles.filter(
      (article) => force || !fs.existsSync(path.join(directory, article.file)),
    );

    if (needsCutting.length) {
      if (!fs.existsSync(manifest.source)) {
        console.log(`  !! ${issueKey}: source PDF not found at ${manifest.source}`);
        process.exitCode = 1;
        continue;
      }
      const source = await PDFDocument.load(fs.readFileSync(manifest.source), {
        ignoreEncryption: true,
      });
      const total = source.getPageCount();

      for (const article of needsCutting) {
        const endPage = Math.min(article.endPage, total);
        if (article.startPage > total) {
          console.log(
            `  !! ${issueKey} #${article.index}: page ${article.startPage} is past the end`,
          );
          process.exitCode = 1;
          continue;
        }
        const size = await cutPages(
          source,
          path.join(directory, article.file),
          article.startPage,
          endPage,
        );
        cutCount += 1;
        if (size > MAX_PDF_BYTES) {
          oversized += 1;
          article.warnings.push(
            `${(size / 1024 / 1024).toFixed(1)}MB — over the 25MB upload limit, split it further`,
          );
        }
      }

      // Oversize is only discovered by cutting, so the plan is rewritten once
      // the sizes are known — but never over a plan a human has edited.
      if (!existingPlan) {
        fs.writeFileSync(planPath(issueKey), JSON.stringify(plan, null, 2), "utf8");
      }
    }

    flagged += plan.articles.filter((article) => article.warnings.length).length;
    report.push({ issueKey, plan });
    console.log(
      `  ok ${issueKey}: ${plan.articles.length} articles` +
        (existingPlan ? " (existing plan kept)" : "") +
        (needsCutting.length ? `, ${needsCutting.length} cut` : ", already cut"),
    );
  }

  if (!dry) {
    fs.writeFileSync(reviewPath, renderReview(report), "utf8");
    console.log(`\n  ${cutCount} article PDFs written under ${path.join(config.outDir, "pdfs")}`);
    console.log(`  review ${flagged} flagged article(s) in ${reviewPath}`);
    if (oversized) console.log(`  ${oversized} exceed the 25MB upload limit and will fail to load`);
  }
}

function renderReview(report) {
  const lines = [
    "# PDF track — what `pdf-load` will create",
    "",
    "One row per article. Edit `out/pdfs/<issueKey>/plan.json` to change any of it;",
    "`split` will not overwrite a plan that already exists (use `--force` to regenerate).",
    "",
    "`!` marks an article whose **title or page range** needs a human. Everything",
    "else was read from a section strap and a byline on the article's own opening",
    "page, or from a contents entry that parsed cleanly.",
    "",
    "Categories are keyword-scored and are the least certain column here, but also",
    "the cheapest to change — they are a dropdown in the CMS, where the title is a",
    "slug. Close calls are listed per issue under the fold rather than flagged.",
    "",
  ];

  for (const { issueKey, plan } of report) {
    lines.push(`## ${issueKey}`);
    lines.push("");
    lines.push(
      `Volume ${plan.volumeNumber}, issue ${plan.issueNumber} — ${plan.period ?? "period unknown"}`,
    );
    lines.push("");
    lines.push("| | # | pages | section | category | title | author | source |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const article of plan.articles) {
      const flag = article.warnings.length ? "!" : "";
      lines.push(
        `| ${flag} | ${article.index} | ${article.startPage}–${article.endPage} | ${article.sectionLabel} | ` +
          `${article.categoryName} | ${article.title ?? "**(none)**"} | ${article.authorName} | ${article.titleSource} |`,
      );
    }
    lines.push("");

    if (plan.coversDropped) {
      lines.push(
        "- Page 1 was listed as an article by the contents page; it is the issue cover " +
          "and was left out. It is still in the issue's own PDF.",
      );
    }

    // Pages the contents listing never claimed. A few are back matter; dozens
    // mean the listing stopped short and articles are missing from this plan.
    const tail = (plan.issuePageCount ?? 0) - Math.max(...plan.articles.map((a) => a.endPage));
    if (tail >= 8) {
      lines.push(
        `- **${tail} pages** at the end of this issue (after page ` +
          `${Math.max(...plan.articles.map((a) => a.endPage))} of ${plan.issuePageCount}) are in no article. ` +
          "Back matter, or articles the contents page did not list.",
      );
    }

    for (const article of plan.articles) {
      for (const warning of article.warnings) lines.push(`- **#${article.index}** — ${warning}`);
    }
    const noted = plan.articles.filter((article) => article.notes?.length);
    if (noted.length) {
      lines.push("");
      lines.push("<details><summary>Softer notes — worth a glance, nothing broken</summary>");
      lines.push("");
      for (const article of noted) {
        for (const note of article.notes) lines.push(`- #${article.index} — ${note}`);
      }
      lines.push("");
      lines.push("</details>");
    }
    lines.push("");
  }

  return lines.join("\n");
}
