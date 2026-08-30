/**
 * DOCX stage 2 — docx-blocks.
 *
 * The element flow plus its segment ranges in, one draft payload per article
 * out. This is the stage the PDF track had to pay a model for; here it is a
 * mapping, because Word already recorded the answers:
 *
 *   Heading1..4  -> heading (level)      w:numPr  -> list (grouped)
 *   w:tbl        -> table                w:drawing -> image (in position)
 *   anything else with text -> paragraph
 *
 * Output lands in out/docx/<issueKey>/draft/NN.json, in the payload shape
 * commands/load.js already consumes — with one deliberate exception: `image`
 * blocks carry `content.ref` (a Word media filename) instead of `content.
 * mediaId` (a uuid). Nothing has been uploaded yet, so no uuid exists. Those
 * drafts would fail blocksArraySchema, which is why they live here and not in
 * out/structured/ — docx-media resolves the refs and writes that directory.
 *
 * Metadata (summary, author, category) is seeded where it can be read off the
 * document and left empty otherwise, for a human or a model to fill in before
 * docx-media runs. Empty is honest; invented is not.
 */
import fs from "node:fs";
import path from "node:path";
import config, { paths } from "../config.js";
import { issueKeyFor } from "./extract.js";
import { listDocx } from "../lib/docx.js";

/** A line that is nothing but a URL, optionally preceded by a footnote marker. */
const BARE_URL = /^(?:\d{1,2}\s+)?(https?:\/\/\S+)$/i;

/** A continuation of the previous line's URL, which the two-column set wraps. */
const URL_TAIL = /^[\w./%~#?&=+-]+$/;

/**
 * A byline: a short line of name-shaped words, directly under the title,
 * optionally followed by a role ("Mr R N Sen, Editor-in-Chief"). Only the name
 * is captured — `authorName` is a name column, and the role belongs in
 * `authorBio` if anywhere.
 *
 * Deliberately narrow: a false positive silently steals the article's first
 * sentence and prints a stranger's name on it.
 */
const BYLINE =
  /^(?:by\s+)?((?:(?:Mr|Mrs|Ms|Dr|Prof|Er)\.?\s+)?\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){1,3})(?:\s*,\s*[\p{L}\s.&'-]{2,40})?$/u;

const MAX_HEADING = 300;

/**
 * Shortest paragraph a column break could plausibly have cut in half.
 *
 * Measured, not guessed: across this issue the genuine broken halves run 46-79
 * characters, while the short unterminated lines that must NOT absorb the text
 * below them — "SUGGESTION/ COMMENT/ OBJECTION", "Our Expertise", a bare
 * caption — are all under 35.
 */
const MIN_BROKEN_PARAGRAPH = 40;

/** The margin-summary label the tutorial articles carry. */
const SYNOPSIS_LABEL = /^Synopsis\s*\d*$/i;

/** A final word no finished sentence ends on. */
const DANGLING_TAIL =
  /\b(?:of|by|to|and|or|with|for|in|on|at|as|from|that|which|the|a|an|is|are|was|were|be|been|shall|will|under|through|into|over|between|per|via|than|when|while|if|but|not|its|their|his|her|our|your)$/i;

/** Word emits many empty paragraphs; they are line spacing, not content. */
const hasText = (element) => Boolean(element.text && element.text.trim());

/**
 * Blocks for one article's element range.
 *
 * Runs of list items sharing a `numId` collapse into one `list` block, images
 * are emitted where they sit, and footnote URLs are pulled out into a single
 * trailing `reference` block rather than being left as stray paragraphs
 * mid-prose.
 */
export function blocksFor(elements, { title, sectionLabel, usableImages }) {
  const blocks = [];
  const references = [];
  const notes = [];

  // Titles arrive in pieces. The magazine sets them across several lines and
  // several styles — a Heading2 reading "Summary of Draft Electricity
  // Amendment" followed by a loose paragraph reading "– 2020"; a text box
  // whose only content is "Billing complaint Redressal". Each of those is the
  // article's own title, which the Article row already carries, so repeating it
  // as the first block prints it twice. Only fragments arriving *before* any
  // body content are treated this way: further down, the same words are prose.
  const titleKey = normalize(title);
  const sectionKey = normalize(sectionLabel ?? "");
  let inTitleZone = true;

  // The printed page rules off each section with a banner — "TUTORIAL",
  // "CONSUMER", "WBERC" — set as Heading1, one or two words, all caps. Article
  // titles are Heading2. That banner is navigation furniture, and the
  // information in it is already on the row as `sectionLabel`, so publishing it
  // as a heading inside the article says the same thing twice. A banner also
  // belongs to the section it opens, not to the article it happens to fall
  // inside, so the one trailing "CONSUMER" at the end of the Covid-19 piece
  // would otherwise be flatly wrong.
  const isSectionBanner = (element, text) => {
    const key = normalize(text);
    if (sectionKey && (sectionKey.startsWith(key) || key.startsWith(sectionKey))) return true;
    return element.level === 1 && text.split(/\s+/).length <= 3;
  };
  const isTitleResidue = (text) => {
    const key = normalize(text);
    return key.length >= 4 && (titleKey.includes(key) || key.includes(titleKey));
  };

  let pendingList = null;
  const flushList = () => {
    if (!pendingList) return;
    if (pendingList.items.length) {
      blocks.push({
        blockType: "list",
        content: { style: pendingList.style, items: pendingList.items },
      });
    }
    pendingList = null;
  };

  // Word carries the magazine's page furniture as images too — the 18x27
  // hairlines that rule off a margin note, at under 200 bytes each. They were
  // measured and marked unusable at extract time; emitting a block for one
  // would upload it to the media library and print a smudge in the article.
  const pushImages = (element) => {
    for (const ref of element.images) {
      if (usableImages && !usableImages.has(ref)) continue;
      blocks.push({ blockType: "image", content: { ref } });
    }
  };

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];

    if (element.kind === "toc") continue;

    if (element.kind === "table") {
      flushList();
      const rows = element.rows.filter((row) => row.some((cell) => cell.trim()));
      if (rows.length < 2) {
        // One row is a layout table, not data. Its cells are prose.
        for (const cell of rows.flat().filter(Boolean)) {
          blocks.push({ blockType: "paragraph", content: { text: cell } });
        }
      } else {
        const columns = rows[0].map((cell, column) => cell.trim() || `Column ${column + 1}`);
        const body = rows.slice(1).map((row) => {
          const cells = row.slice(0, columns.length);
          while (cells.length < columns.length) cells.push("");
          return cells;
        });
        blocks.push({ blockType: "table", content: { columns, rows: body } });
      }
      inTitleZone = false;
      pushImages(element);
      continue;
    }

    if (element.kind === "listItem") {
      pushImages(element);
      if (!hasText(element)) continue;
      if (pendingList && pendingList.numId !== element.numId) flushList();
      pendingList ??= { numId: element.numId, style: element.listStyle, items: [] };
      pendingList.items.push(element.text.trim());
      inTitleZone = false;
      continue;
    }

    flushList();
    pushImages(element);
    if (!hasText(element)) continue;

    const text = element.text.trim();

    if (element.kind === "heading") {
      // The article's own title is not a block inside itself.
      if (normalize(text) === titleKey || (inTitleZone && isTitleResidue(text))) continue;
      if (isSectionBanner(element, text)) continue;
      const level = Math.min(Math.max(element.level ?? 2, 2), 6);
      blocks.push({ blockType: "heading", content: { level, text: text.slice(0, MAX_HEADING) } });
      continue;
    }

    if (inTitleZone && isTitleResidue(text)) continue;

    const url = BARE_URL.exec(text);
    if (url) {
      // A wrapped URL continues on the next line, with no punctuation to say so.
      let full = url[1];
      while (index + 1 < elements.length) {
        const next = elements[index + 1];
        if (next.kind !== "paragraph" || !hasText(next) || !URL_TAIL.test(next.text.trim())) break;
        full += next.text.trim();
        index += 1;
      }
      references.push({ label: full, url: full });
      continue;
    }

    blocks.push({ blockType: "paragraph", content: { text } });
    inTitleZone = false;
  }

  flushList();

  if (references.length) {
    blocks.push({ blockType: "reference", content: { items: dedupeReferences(references) } });
  }

  return { blocks, notes };
}

/**
 * The magazine prints a running margin summary beside its tutorial articles —
 * a small "Synopsis 3" label above one sentence restating the rule opposite it.
 * As two loose paragraphs that reads as a stray number followed by an orphaned
 * sentence; as a `callout` it renders the way it was set, and the label becomes
 * the title it always was.
 */
export function foldSynopsisCallouts(blocks) {
  const output = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const label = block.blockType === "paragraph" && SYNOPSIS_LABEL.exec(block.content.text.trim());
    const body = blocks[index + 1];

    if (label && body?.blockType === "paragraph" && body.content.text.trim()) {
      output.push({
        blockType: "callout",
        content: { title: label[0], text: body.content.text.trim() },
      });
      index += 1;
      continue;
    }
    output.push(block);
  }
  return output;
}

export function repairSplitProse(blocks) {
  const repairs = [];
  const { blocks: capped, repairs: capRepairs } = restoreDropCap(blocks);
  const { blocks: joined, repairs: joinRepairs } = joinContinuations(capped);
  repairs.push(...capRepairs, ...joinRepairs);
  return { blocks: joined, repairs };
}

const text = (block) => block?.content?.text ?? "";
const opensLowercase = (block) => /^[\p{Ll}]/u.test(text(block).trim());
const isOpen = (value) => Boolean(value.trim()) && !/[.!?:;”"’')\]]$/.test(value.trim());
const danglesOpen = (value) => DANGLING_TAIL.test(value.trim());

/**
 * Where the magazine sets a large initial letter, the conversion emits it as
 * its own run, which splits the opening paragraph and strands the letter on the
 * front of the *second* half:
 *
 *     "ue to COVID 19, India declared nationwide lock down … no indication of"
 *     "Dits complete control for resuming business as usual…"
 *
 * An article whose first paragraph opens in lower case is never correct, which
 * is what makes this safe to repair rather than merely flag: the capital goes
 * back to the front and the halves are rejoined.
 *
 * This runs **before** joinContinuations, and the order is load-bearing. Once
 * the continuation pass has welded the stranded half into the paragraph above,
 * the still-lower-case opening is left looking for a donor and takes the
 * initial off whatever paragraph follows — turning "Are you an electricity
 * consumer?" into "Lre you an electricity consumer?" and eating the "L" off
 * "Law—would you be interested…" three paragraphs later.
 */
export function restoreDropCap(blocks) {
  const output = [...blocks];
  const first = output.findIndex((block) => block.blockType === "paragraph");
  if (first < 0 || !opensLowercase(output[first]) || !isOpen(text(output[first]))) {
    return { blocks: output, repairs: [] };
  }

  // The donor is the next paragraph, or very nearly: an image or a heading may
  // sit between the two halves, but prose may not.
  for (let at = first + 1; at < Math.min(output.length, first + 4); at += 1) {
    const donor = output[at];
    if (donor.blockType !== "paragraph") continue;
    const match = /^(\p{Lu})(?=\p{Ll})(.*)$/su.exec(text(donor).trim());
    if (!match) break;
    const [, initial, rest] = match;
    output[first] = {
      ...output[first],
      content: {
        ...output[first].content,
        text: `${initial}${text(output[first]).trim()} ${rest.trim()}`,
      },
    };
    output.splice(at, 1);
    return {
      blocks: output,
      repairs: [`restored drop cap "${initial}" and rejoined the opening paragraph`],
    };
  }

  return { blocks: output, repairs: [] };
}

/**
 * The magazine is set in two columns, and the conversion broke a paragraph
 * wherever a column did. The halves are adjacent and in the right order; only
 * the join was lost:
 *
 *     "…raising electricity bills based on consumption of correspond period
 *      of last year in the absence of actual meter reading. In some"
 *     "cases, some abnormal amount has also been claimed."
 *
 * Two signals authorise a join, and either is enough: the second half opens in
 * lower case, or the first half ends on a function word, which no finished
 * sentence does ("…shall also be specified by" / "SERCs"). A merge is refused
 * where the first half is too short to have filled a column — a byline, a
 * caption or a label like "SUGGESTION/ COMMENT/ OBJECTION" must not swallow the
 * paragraph beneath it.
 *
 * What survives both tests stays split, and stays listed in review.md.
 */
export function joinContinuations(blocks) {
  const repairs = [];
  const output = [];

  for (const block of blocks) {
    // What sits directly above is not necessarily the prose above. The magazine
    // floats images and margin summaries alongside the text, and the conversion
    // drops them into reading order wherever their anchor fell — routinely
    // between the two halves of one sentence:
    //
    //     "…the consumer may lodge a complaint with the GRO of the licensee and"
    //     [image] [Synopsis 7] [Synopsis 8]
    //     "in case no redress to his satisfaction is achieved from the GRO…"
    //
    // So look back over any run of images and *finished* callouts. They stay
    // where they are; the sentence is what has to come back together. A callout
    // that is itself unfinished is excluded from the skip — that one is a
    // margin summary cut by a column break, and the tail below belongs to it.
    const isInterposed = (candidate) =>
      candidate.blockType === "image" ||
      (candidate.blockType === "callout" && !isOpen(text(candidate)));

    let at = output.length - 1;
    while (at >= 0 && isInterposed(output[at])) at -= 1;
    const previous = at >= 0 ? output[at] : undefined;

    // Whatever actually ends the previous block: its text for a paragraph or a
    // callout, its final item for a list.
    const previousTail =
      previous?.blockType === "list"
        ? (previous.content.items[previous.content.items.length - 1] ?? "")
        : text(previous);

    if (
      block.blockType === "paragraph" &&
      previous &&
      (opensLowercase(block) || danglesOpen(previousTail))
    ) {
      const tail = text(block).trim();

      if (
        previous.blockType === "paragraph" &&
        isOpen(text(previous)) &&
        text(previous).trim().length >= MIN_BROKEN_PARAGRAPH
      ) {
        previous.content.text = `${text(previous).trim()} ${tail}`;
        repairs.push(`joined continuation: "…${tail.slice(0, 45)}"`);
        continue;
      }

      // A margin summary is broken by the same column rule as everything else,
      // and it was folded into a callout one pass ago — so its tail arrives
      // here with a callout, not a paragraph, above it.
      if (previous.blockType === "callout" && isOpen(text(previous))) {
        previous.content.text = `${text(previous).trim()} ${tail}`;
        repairs.push(`joined callout continuation: "…${tail.slice(0, 45)}"`);
        continue;
      }

      // The same break inside a list strands the tail of the final item. No
      // length floor here: a list item is short by nature.
      if (previous.blockType === "list") {
        const items = previous.content.items;
        const last = items[items.length - 1];
        if (isOpen(last)) {
          items[items.length - 1] = `${last.trim()} ${tail}`;
          repairs.push(`joined list-item continuation: "…${tail.slice(0, 45)}"`);
          continue;
        }
      }
    }

    output.push(block);
  }

  return { blocks: output, repairs };
}

function dedupeReferences(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Pulls the byline out of the first few elements after the title, if there is
 * one. Returns the author and the elements with that paragraph removed.
 */
export function extractByline(elements) {
  for (let index = 0; index < Math.min(elements.length, 4); index += 1) {
    const element = elements[index];
    if (element.kind !== "paragraph" || !hasText(element)) continue;
    const text = element.text.trim();
    if (text.length > 60) break; // prose has started; there is no byline
    const match = BYLINE.exec(text);
    if (match) {
      return { authorName: match[1], elements: elements.filter((_, at) => at !== index) };
    }
  }
  return { authorName: null, elements };
}

/**
 * Assembles every piece of the issue into one article's block sequence.
 *
 * One document is one Article. The magazine's own structure survives as
 * headings rather than as separate rows:
 *
 *   heading 2  "Contents"
 *   list       one line per piece, "<Section> — <Title>"
 *   heading 2  section banner, only where the section changes
 *   heading 3  piece title
 *   …          that piece's blocks
 *   reference  every citation in the issue, gathered at the end
 *
 * The contents list is built from `segments.json`, not from the printed
 * contents page in elements 6-22. That page exists, but the conversion wrapped
 * its titles mid-phrase and glued the folio onto the end of each
 * ("Highlights on electricity supply code regulations" / "published by
 * WBERC5"). The segments carry the same nine entries already spelled correctly
 * and already reviewed — the same information without the fragile parsing.
 *
 * `references` are pulled out of each piece and re-emitted once at the end.
 * Left in place, the footnote from the draft-bill article becomes a
 * "References" heading stranded two thirds of the way down a single page.
 */
/** A section whose only piece carries the section's own name, e.g. Editorial. */
const sameHeading = (section, title) => Boolean(section) && normalize(section) === normalize(title);

const contentsEntry = (piece) =>
  !piece.sectionLabel || sameHeading(piece.sectionLabel, piece.title)
    ? piece.title
    : `${piece.sectionLabel} — ${piece.title}`;

export function assembleIssue(pieces, { contentsHeading = "Contents" } = {}) {
  const blocks = [];
  const references = [];

  if (pieces.length) {
    blocks.push({ blockType: "heading", content: { level: 2, text: contentsHeading } });
    blocks.push({
      blockType: "list",
      content: { style: "unordered", items: pieces.map(contentsEntry) },
    });
  }

  let openSection = null;
  for (const piece of pieces) {
    if (piece.sectionLabel && piece.sectionLabel !== openSection) {
      blocks.push({
        blockType: "heading",
        content: { level: 2, text: piece.sectionLabel.slice(0, MAX_HEADING) },
      });
      openSection = piece.sectionLabel;
    }

    // The Editorial is its own whole section, so its banner and its title are
    // the same word. Printing it twice — as a section heading and again as a
    // piece heading directly beneath — reads as a mistake.
    if (!sameHeading(piece.sectionLabel, piece.title)) {
      blocks.push({
        blockType: "heading",
        content: { level: 3, text: piece.title.slice(0, MAX_HEADING) },
      });
    }

    for (const block of piece.blocks) {
      if (block.blockType === "reference") {
        references.push(...block.content.items);
        continue;
      }
      // A piece's own headings sit below its title. They are all Word
      // `Heading4` in this corpus, so this is a guard against a future issue
      // whose subheadings would otherwise collide with the section banners.
      if (block.blockType === "heading") {
        blocks.push({
          blockType: "heading",
          content: { ...block.content, level: Math.min(6, Math.max(4, block.content.level)) },
        });
        continue;
      }
      blocks.push(block);
    }
  }

  if (references.length) {
    blocks.push({ blockType: "reference", content: { items: dedupeReferences(references) } });
  }

  return blocks;
}

/**
 * Puts back the spaces Word's PDF reflow ate.
 *
 * Where the magazine breaks a line mid-sentence, the conversion sometimes joins
 * the two runs with no separator: "state governments forbringing", "which
 * arecurrently assigned", "there will besubstantial improvement". Across
 * Volume 1 that is ~4.5% of every long word — visible in the body copy and
 * invisible to a spellchecker, since the halves are both real words.
 *
 * The PDF text is the evidence. A split is only accepted when both halves and
 * the pair itself occur in the article's own pages, so a genuine long word is
 * never broken up: "recommendations" stays whole because the source contains it
 * and contains no "recommend ations".
 */
export function repairGluedWords(blocks, pdfText) {
  const normalized = pdfText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return { blocks, repaired: 0 };

  const words = new Set(normalized.split(" "));
  let repaired = 0;

  const fix = (text) =>
    text.replace(/[A-Za-z]{8,}/g, (token) => {
      const lower = token.toLowerCase();
      if (words.has(lower)) return token;
      // From 2, not 3: the words that get glued are overwhelmingly the short
      // ones a line breaks after — "be substantial", "to consumers", "of the".
      // The bigram check below is what keeps that safe.
      for (let cut = 2; cut <= lower.length - 2; cut += 1) {
        const left = lower.slice(0, cut);
        const right = lower.slice(cut);
        if (!words.has(left) || !words.has(right)) continue;
        if (!normalized.includes(`${left} ${right}`)) continue;
        repaired += 1;
        return `${token.slice(0, cut)} ${token.slice(cut)}`;
      }
      return token;
    });

  const walk = (block) => {
    const content = { ...block.content };
    if (typeof content.text === "string") content.text = fix(content.text);
    if (typeof content.caption === "string") content.caption = fix(content.caption);
    if (Array.isArray(content.items)) {
      // List items are strings; reference items are {label, url} objects. A URL
      // is never touched — a space inserted into one breaks the link.
      content.items = content.items.map((item) =>
        typeof item === "string" ? fix(item) : { ...item, label: fix(item.label ?? "") },
      );
    }
    if (Array.isArray(content.rows)) content.rows = content.rows.map((row) => row.map(fix));
    if (Array.isArray(content.columns)) content.columns = content.columns.map(fix);
    return { ...block, content };
  };

  return { blocks: blocks.map(walk), repaired };
}

/** The article's own pages, as the PDF track extracted them. */
function pdfTextFor(issueKey, pages) {
  if (!pages) return "";
  const [start, end] = String(pages).split("-").map(Number);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  let text = "";
  for (let page = start; page <= end; page += 1) {
    const file = path.join(
      paths.raw(issueKey),
      "flow",
      `page-${String(page).padStart(3, "0")}.txt`,
    );
    if (fs.existsSync(file)) text += `\n${fs.readFileSync(file, "utf8")}`;
  }
  return text;
}

export default async function docxBlocks({ only, force }) {
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
    const dir = paths.docx(issueKey);
    const flowPath = path.join(dir, "flow.json");
    const segmentsPath = path.join(dir, "segments.json");

    if (!fs.existsSync(flowPath) || !fs.existsSync(segmentsPath)) {
      console.warn(`  !! ${issueKey}: run docx-extract first, skipping`);
      process.exitCode = 1;
      continue;
    }

    const flow = JSON.parse(fs.readFileSync(flowPath, "utf8"));
    const { segments, strategy } = JSON.parse(fs.readFileSync(segmentsPath, "utf8"));
    const manifest = JSON.parse(fs.readFileSync(paths.manifest(issueKey), "utf8"));

    // Two output shapes, decided by what stage 1 was able to segment.
    //
    // "prose" means the PDF track's plan drove the segmentation, so every piece
    // is a real article with a reviewed title, author and category — one
    // payload each, matching the articles that already exist in the CMS.
    //
    // Anything else means the segments came from heading matching on a
    // Word-authored document, where the pieces are sections of one publication
    // rather than separate articles. Those still assemble into a single payload
    // with a contents list, which is what the amendment-bill issue is.
    const perArticle = strategy === "prose";

    // Size and dimension already excluded the hairlines and spacers. This
    // excludes the other kind of furniture: a graphic the magazine prints on
    // every page — a masthead logo, a page border — which the PDF conversion
    // emits once per page. Those pass every size test, because they are real
    // artwork; what gives them away is the count. Volume 2's issues carry one
    // used 35-42 times, and V1_I14 one used 34 times; left in, an article
    // repeats the same logo down its whole length.
    //
    // Three is the ceiling for genuine artwork here: a figure appears once, and
    // twice where an article is reprinted later in the same issue.
    const REPEATS_AS_FURNITURE = 3;
    const furniture = new Set(
      (flow.media ?? [])
        .filter((item) => (item.uses ?? 0) > REPEATS_AS_FURNITURE)
        .map((item) => item.fileName),
    );
    const usableImages = new Set(
      (flow.media ?? [])
        .filter((item) => item.usable && !furniture.has(item.fileName))
        .map((item) => item.fileName),
    );
    if (furniture.size) {
      console.log(
        `  -- ${issueKey}: ${furniture.size} image(s) dropped as page furniture (used >${REPEATS_AS_FURNITURE}×)`,
      );
    }

    const draftDir = path.join(dir, "draft");
    fs.mkdirSync(draftDir, { recursive: true });

    const existing = fs.readdirSync(draftDir).filter((name) => /^\d+\.json$/.test(name));
    if (existing.length && !force) {
      // Drafts are hand-edited between this stage and docx-media — title,
      // byline, category, summary, and any split the repairs refused.
      // Clobbering them on a re-run would throw that work away silently.
      console.log(`  -- ${issueKey}: already drafted (--force to rebuild)`);
      continue;
    }
    for (const name of existing) fs.rmSync(path.join(draftDir, name));

    const pieces = [];
    const skipped = [];
    const repairs = [];
    const bylines = [];

    for (const segment of segments) {
      if (segment.skip) continue;
      if (segment.startElement === null || segment.endElement === null) {
        skipped.push(
          `#${segment.index} "${segment.title}" — no element range; set one in segments.json`,
        );
        continue;
      }

      const slice = flow.elements.slice(segment.startElement, segment.endElement + 1);
      const { authorName, elements } = extractByline(slice);
      const built = blocksFor(elements, {
        title: segment.title,
        sectionLabel: segment.sectionLabel,
        usableImages,
      });
      // Fold before repairing: a callout is neither a paragraph nor a list, so
      // once the label and its sentence are one block the continuation pass
      // cannot absorb either half into the prose above.
      const piece = repairSplitProse(foldSynopsisCallouts(built.blocks));

      // Only the prose track has page ranges to check the words against.
      const glued = repairGluedWords(piece.blocks, pdfTextFor(issueKey, segment.pages));
      piece.blocks = glued.blocks;
      if (glued.repaired) {
        repairs.push(
          `#${segment.index} rejoined ${glued.repaired} word(s) the reflow ran together`,
        );
      }

      if (authorName) bylines.push(`${authorName} — ${segment.title}`);
      repairs.push(...piece.repairs.map((note) => `#${segment.index} ${note}`));
      pieces.push({
        index: segment.index,
        title: segment.title,
        sectionLabel: segment.sectionLabel ?? null,
        sourceElements: `${segment.startElement}-${segment.endElement}`,
        // The plan's byline was read off the printed page and reviewed; the one
        // found in the DOCX is a fallback for where it was not.
        authorName: segment.authorName || authorName || "",
        categoryName: segment.categoryName ?? "",
        summary: segment.summary ?? "",
        blocks: piece.blocks,
      });
    }

    if (perArticle) {
      for (const piece of pieces) {
        const name = `${String(piece.index).padStart(2, "0")}.json`;
        fs.writeFileSync(
          path.join(draftDir, name),
          JSON.stringify(
            {
              issueKey,
              articleIndex: piece.index,
              title: piece.title,
              sectionLabel: piece.sectionLabel,
              authorName: piece.authorName,
              categoryName: piece.categoryName,
              summary: piece.summary,
              blocks: piece.blocks,
              sourceElements: piece.sourceElements,
              notes: repairs.filter((note) => note.startsWith(`#${piece.index} `)),
              source: "docx",
              builtAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          "utf8",
        );
      }

      const images = pieces.reduce(
        (total, piece) => total + piece.blocks.filter((b) => b.blockType === "image").length,
        0,
      );
      console.log(
        `  ${issueKey}  vol ${manifest.volumeNumber} issue ${manifest.issueNumber ?? "?"}`,
      );
      console.log(
        `    ok ${pieces.length} articles — ${pieces.reduce((n, p) => n + p.blocks.length, 0)} blocks (${images} images, ${repairs.length} repairs)`,
      );
      for (const line of skipped) console.log(`    -- ${line}`);
      if (skipped.length) process.exitCode = 1;
      continue;
    }

    const target = path.join(draftDir, "00.json");
    const blocks = assembleIssue(pieces);

    const payload = {
      issueKey,
      // One document is one Article, so there is exactly one payload and its
      // index is 0. The field is kept because the ledger, validate and resync
      // all key on it.
      articleIndex: 0,
      title: manifest.title ?? issueKey,
      authorName: "",
      categoryName: "",
      summary: "",
      blocks,
      pieces: pieces.map(({ index, title, sectionLabel, sourceElements, authorName }) => ({
        index,
        title,
        sectionLabel,
        sourceElements,
        authorName,
      })),
      notes: [
        "title, authorName, categoryName and summary are unset — fill them before docx-media",
        bylines.length
          ? `bylines found inside the document: ${bylines.join("; ")}`
          : "no bylines found inside the document",
        ...repairs,
      ].filter(Boolean),
      source: "docx",
      builtAt: new Date().toISOString(),
    };

    fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");

    const images = blocks.filter((block) => block.blockType === "image").length;
    console.log(`  ${issueKey}  vol ${manifest.volumeNumber} issue ${manifest.issueNumber ?? "?"}`);
    console.log(
      `    ok one article — ${blocks.length} blocks from ${pieces.length} pieces (${images} images, ${repairs.length} repairs)`,
    );
    for (const line of skipped) console.log(`    -- ${line}`);
    if (skipped.length) process.exitCode = 1;
  }
}
