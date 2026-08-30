/**
 * DOCX stage 1 — docx-extract.
 *
 * .docx in, a reviewable element flow out. Deterministic, offline, free, and
 * safe to re-run.
 *
 * Writes out/docx/<issueKey>/:
 *   flow.json     every body element in document order, already typed by Word
 *   media/        word/media/* extracted verbatim
 *   segments.json a *proposed* article index -> element range mapping
 *   review.md     everything this stage could not settle on its own
 *
 * Segmentation reuses the PDF track's manifest rather than re-deriving article
 * boundaries: those titles and section labels were already parsed from the
 * printed table of contents and reviewed by a human. The only new question is
 * where each of them starts in the DOCX, which is answered by matching the
 * manifest's titles against Word's own heading elements.
 *
 * Nothing here guesses quietly. A title that does not match a heading well
 * enough gets `startElement: null` and a line in review.md.
 */
import fs from "node:fs";
import path from "node:path";
import config, { paths } from "../config.js";
import { issueKeyFor } from "./extract.js";
import { readZip, walkDocument, inventoryMedia, listDocx } from "../lib/docx.js";
import { anchorArticles } from "../lib/anchor.js";
import { planPath } from "./split.js";

/** Words too common in these titles to be evidence of anything. */
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "on",
  "in",
  "to",
  "for",
  "and",
  "or",
  "at",
  "by",
  "is",
  "it",
  "as",
  "with",
  "from",
  "its",
  "this",
  "that",
  "be",
  "are",
]);

/** The PDF track's own text for one page, which the prose anchors are cut from. */
function readRawPage(issueKey, page) {
  const file = path.join(paths.raw(issueKey), "flow", `page-${String(page).padStart(3, "0")}.txt`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

const tokenize = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));

/**
 * How well a heading answers to a manifest title, 0..1.
 *
 * F1 of the two containments, not `Math.max` of them: taking the max lets any
 * short generic heading claim any title that happens to contain its one word.
 * ("Energy", the news-roundup subheading on page 45, scored a perfect 1.0
 * against "About Energy Konnect" and swallowed the whole issue.) F1 needs the
 * match to run both ways, which the true anchors do.
 *
 * The one case F1 is wrong about is the real asymmetry in this corpus: the
 * printed TOC carries a fuller title than the heading Word kept — "Highlights
 * on electricity supply code regulations published by WBERC" against a heading
 * reading just "WBERC". That is rescued explicitly, and only when the heading's
 * words are distinctive enough to be evidence: `distinctive` holds the tokens
 * that occur in exactly one heading in the whole document, so "wberc" qualifies
 * and "energy" does not.
 */
function score(titleTokens, headingTokens, distinctive) {
  if (!titleTokens.length || !headingTokens.length) return 0;
  const title = new Set(titleTokens);
  const heading = new Set(headingTokens);
  const shared = [...title].filter((token) => heading.has(token));
  if (!shared.length) return 0;

  const forward = shared.length / title.size;
  const backward = shared.length / heading.size;

  const headingFitsInsideTitle = backward === 1 && heading.size <= 3;
  if (headingFitsInsideTitle && shared.some((token) => distinctive.has(token))) return 1;

  return (2 * forward * backward) / (forward + backward);
}

const CONFIDENT = 0.6;

/**
 * Proposes an element range per manifest article.
 *
 * Anchors are found in manifest order and are forced to advance — an article
 * later in the printed issue cannot start before an earlier one. Each article
 * then runs to the element before the next anchor.
 */
export function proposeSegments(elements, manifest) {
  const headings = elements
    .map((element, position) => ({ element, position, tokens: tokenize(element.text) }))
    .filter(({ element }) => element.kind === "heading" && element.text.trim());

  // Tokens occurring in exactly one heading. See score() — these are the only
  // words a very short heading may be matched on.
  const headingCount = new Map();
  for (const { tokens } of headings) {
    for (const token of new Set(tokens))
      headingCount.set(token, (headingCount.get(token) ?? 0) + 1);
  }
  const distinctive = new Set([...headingCount].filter(([, n]) => n === 1).map(([token]) => token));

  const anchors = [];
  let floor = 0;

  for (const article of manifest.articles) {
    // Front matter the manifest already dismissed ("About Energy Konnect") gets
    // no anchor and, crucially, does not advance the floor: it has no heading
    // of its own, so any match it made would be a false one that pushed every
    // real article past its own title.
    if (article.skip) {
      anchors.push({ article, position: null, matchedHeading: null, value: 0 });
      continue;
    }

    const titleTokens = tokenize(article.title);
    let best = null;

    for (const candidate of headings) {
      if (candidate.position < floor) continue;
      const value = score(titleTokens, candidate.tokens, distinctive);
      // Articles are matched in printed order and anchors only move forward, so
      // a tie goes to the earlier heading.
      if (!best || value > best.value + 1e-9) best = { ...candidate, value };
    }

    if (best && best.value >= CONFIDENT) {
      anchors.push({
        article,
        position: best.position,
        matchedHeading: best.element.text,
        value: best.value,
      });
      floor = best.position + 1;
    } else {
      anchors.push({
        article,
        position: null,
        matchedHeading: best?.element.text ?? null,
        value: best?.value ?? 0,
      });
    }
  }

  // A matched article ends where the next matched one begins. An unmatched one
  // has no range at all — deliberately, so docx-blocks refuses it rather than
  // inventing a boundary.
  const segments = anchors.map((anchor, index) => {
    let endElement = null;
    if (anchor.position !== null) {
      const next = anchors.slice(index + 1).find((other) => other.position !== null);
      endElement = (next ? next.position : elements.length) - 1;
    }
    return {
      index: anchor.article.index,
      title: anchor.article.title,
      sectionLabel: anchor.article.sectionLabel,
      skip: Boolean(anchor.article.skip),
      startElement: anchor.position,
      endElement,
      matchedHeading: anchor.matchedHeading,
      matchScore: Number(anchor.value.toFixed(2)),
      confident: anchor.position !== null,
    };
  });

  return segments;
}

/**
 * Segments from the PDF track's plan, anchored on prose rather than headings.
 *
 * Preferred over proposeSegments wherever a plan exists, because it is better
 * evidence on both halves of the question. The plan's article list has already
 * had its scrambled contents entries repaired and its phantom entries folded
 * away, so it asks about real articles; and prose anchoring works on a .docx
 * that Word reflowed out of a PDF, where heading matching finds nothing. See
 * lib/anchor.js.
 */
export function planSegments(elements, plan, readPage) {
  const anchors = anchorArticles(elements, plan.articles, readPage);
  const byIndex = new Map(anchors.map((anchor) => [anchor.index, anchor]));

  return plan.articles.map((article) => {
    const anchor = byIndex.get(article.index);
    return {
      index: article.index,
      title: article.title,
      sectionLabel: article.sectionLabel,
      skip: false,
      startElement: anchor?.position ?? null,
      endElement: anchor?.endPosition ?? null,
      matchedHeading: anchor?.probe ? `prose: "${anchor.probe}"` : null,
      matchScore: anchor?.probesTried
        ? Number((anchor.probesMatched / anchor.probesTried).toFixed(2))
        : 0,
      confident: Boolean(anchor?.confident),

      // Carried through so docx-blocks can seed each article's metadata from
      // the plan instead of leaving it empty for a human to retype.
      authorName: article.authorName,
      categoryName: article.categoryName,
      summary: article.summary ?? "",
      pages: `${article.startPage}-${article.endPage}`,
    };
  });
}

/**
 * Prose the conversion mangled, listed rather than repaired.
 *
 * The magazine sets the opening letter of many articles as a drop cap, and the
 * DOCX conversion turns that into its own run — which splits the first
 * paragraph in two and strands the initial capital on the wrong fragment
 * ("re you an electricity consumer?" / "Asector works?"). Pull-quote text boxes
 * strand fragments the same way. Where the halves rejoin is a judgement call,
 * so this only points at them.
 */
export function findProseProblems(elements, segments) {
  const problems = [];
  const withinArticle = (position) =>
    segments.find(
      (segment) =>
        !segment.skip &&
        segment.startElement !== null &&
        position >= segment.startElement &&
        position <= segment.endElement,
    );

  let previous = null;
  elements.forEach((element, position) => {
    if (element.kind === "table" || !element.text.trim()) return;
    const segment = withinArticle(position);
    if (!segment) {
      previous = element;
      return;
    }

    const text = element.text.trim();
    const opensLowercase = /^[a-z]/.test(text);
    const previousText = previous?.text.trim() ?? "";
    const previousIsOpen = previousText && !/[.!?:;”"’')\]]$/.test(previousText);

    if (opensLowercase && element.kind === "paragraph") {
      problems.push({
        position,
        article: segment.index,
        kind: previous && previousIsOpen ? "orphan-fragment" : "dropped-capital",
        text: text.slice(0, 90),
      });
    }

    previous = element;
  });

  return problems;
}

function writeReview(dir, { issueKey, manifest, elements, segments, media, problems }) {
  const usable = media.filter((item) => item.usable);
  const lines = [
    `# ${issueKey} — DOCX extract review`,
    "",
    `Source: \`${manifest.source ?? "(unknown)"}\``,
    `${elements.length} elements · ${media.length} images (${usable.length} usable) · ${segments.length} manifest articles`,
    "",
    "## Segments",
    "",
    "| # | article | section | elements | matched heading | score |",
    "|---|---|---|---|---|---|",
  ];

  for (const segment of segments) {
    const range =
      segment.startElement === null
        ? "**UNMATCHED**"
        : `${segment.startElement}–${segment.endElement}`;
    const title = segment.skip ? `~~${segment.title}~~` : segment.title;
    lines.push(
      `| ${segment.index} | ${title} | ${segment.sectionLabel ?? "-"} | ${range} | ${segment.matchedHeading ?? "-"} | ${segment.matchScore} |`,
    );
  }

  const unmatched = segments.filter((segment) => !segment.skip && !segment.confident);
  if (unmatched.length) {
    lines.push(
      "",
      `**${unmatched.length} article(s) did not match a heading.** Set \`startElement\`/\`endElement\` in \`segments.json\` by hand, then re-run \`docx-blocks\`.`,
    );
  }

  lines.push("", "## Images", "", "| file | bytes | size | use |", "|---|---|---|---|");
  for (const item of media) {
    lines.push(
      `| ${item.fileName} | ${item.bytes.toLocaleString()} | ${item.width ?? "?"}×${item.height ?? "?"} | ${item.usable ? "yes" : `no — ${item.skipReason}`} |`,
    );
  }

  lines.push("", "## Prose to check", "");
  if (!problems.length) {
    lines.push("None found.");
  } else {
    lines.push("| element | article | kind | text |", "|---|---|---|---|");
    for (const problem of problems) {
      lines.push(
        `| ${problem.position} | ${problem.article} | ${problem.kind} | ${problem.text.replace(/\|/g, "\\|")} |`,
      );
    }
    lines.push(
      "",
      "`dropped-capital` — the magazine's drop cap became its own run, splitting the",
      "paragraph and stranding the initial letter on the wrong half. `orphan-fragment`",
      "— a run (usually a pull-quote text box) landed out of sequence. Both are repaired",
      "in `draft/` after `docx-blocks`, not here.",
    );
  }

  fs.writeFileSync(path.join(dir, "review.md"), `${lines.join("\n")}\n`, "utf8");
}

export default async function docxExtract({ only, force }) {
  const documents = listDocx(config.docxDir).filter(
    (file) => !only || issueKeyFor(file).includes(only.toLowerCase()),
  );

  if (!documents.length) {
    console.error(`No .docx matched under ${config.docxDir}`);
    process.exitCode = 1;
    return;
  }

  for (const source of documents) {
    const issueKey = issueKeyFor(source);
    const manifestPath = paths.manifest(issueKey);

    if (!fs.existsSync(manifestPath)) {
      console.warn(
        `  !! ${issueKey}: no manifest at ${path.relative(config.here, manifestPath)} — run the PDF track's segment stage first, skipping`,
      );
      process.exitCode = 1;
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    const dir = paths.docx(issueKey);
    fs.mkdirSync(path.join(dir, "media"), { recursive: true });

    const files = readZip(source);
    const { elements, imageRefs } = walkDocument(files);
    const media = inventoryMedia(files, {
      minBytes: config.minImageBytes,
      minEdge: config.minImageEdge,
    });

    for (const item of media) {
      fs.writeFileSync(path.join(dir, "media", item.fileName), item.buffer);
    }

    fs.writeFileSync(
      path.join(dir, "flow.json"),
      JSON.stringify(
        {
          issueKey,
          source,
          extractedAt: new Date().toISOString(),
          media: media.map(({ buffer: _buffer, ...rest }) => ({
            ...rest,
            uses: imageRefs.get(rest.fileName) ?? 0,
          })),
          elements,
        },
        null,
        2,
      ),
      "utf8",
    );

    // Hand edits to segments.json are the whole point of the file, so an
    // existing one is never overwritten without --force.
    const segmentsPath = path.join(dir, "segments.json");
    let segments;
    if (fs.existsSync(segmentsPath) && !force) {
      segments = JSON.parse(fs.readFileSync(segmentsPath, "utf8")).segments;
      console.log(`  -- ${issueKey}: keeping existing segments.json (--force to regenerate)`);
    } else {
      // A plan means the PDF track has already been through this issue and its
      // article list is the repaired one. Fall back to heading matching only
      // where there is no plan — a genuinely Word-authored document.
      const planFile = planPath(issueKey);
      const strategy = fs.existsSync(planFile) ? "prose" : "headings";
      segments =
        strategy === "prose"
          ? planSegments(elements, JSON.parse(fs.readFileSync(planFile, "utf8")), (page) =>
              readRawPage(issueKey, page),
            )
          : proposeSegments(elements, manifest);
      fs.writeFileSync(
        segmentsPath,
        JSON.stringify({ issueKey, source, strategy, segments }, null, 2),
        "utf8",
      );
    }

    const problems = findProseProblems(elements, segments);
    writeReview(dir, { issueKey, manifest, elements, segments, media, problems });

    const matched = segments.filter((segment) => !segment.skip && segment.confident).length;
    const wanted = segments.filter((segment) => !segment.skip).length;
    const usable = media.filter((item) => item.usable).length;
    console.log(
      `  ok ${issueKey}  ${elements.length} elements  ${matched}/${wanted} articles anchored  ${usable}/${media.length} images usable  ${problems.length} prose flags`,
    );
    if (matched < wanted) {
      console.log(`     see ${path.relative(config.here, path.join(dir, "review.md"))}`);
      process.exitCode = 1;
    }
  }
}
