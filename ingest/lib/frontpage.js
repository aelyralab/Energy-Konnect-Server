/**
 * Recovering an article's headline, byline and section from its opening page.
 *
 * The manifests built by stage 2 take their titles from the printed table of
 * contents. That is the right first source — it is the magazine's own
 * statement of what it contains — but the TOC is a designed, multi-column
 * block, and `pdftotext -layout` interleaves its columns on the issues whose
 * contents page sets two lists side by side. The damage is visible: titles
 * like "AAbboouuttEEnneerrggyyKKoonnnneecctt" or a bare "Issue".
 *
 * An article's own opening page is the second source, and on the later issues
 * it is the better one. It prints, in order: the masthead, the section strap,
 * the headline, the byline, then body copy. That is enough structure to read
 * back a clean title *and* the author name — which the TOC never carries.
 *
 * Neither source wins outright, which is why this module reports what it found
 * and how sure it is, and lib/titles.js picks between them:
 *
 *   - Volume 1 issues 2-9 set the headline as a pull-quote down the left
 *     margin. `-layout` glues each of its words onto the body line beside it
 *     ("Draft   Around 60+ Indian state discoms are..."), and no headline is
 *     recoverable. These come back `confident: false` and their TOC titles,
 *     which parse cleanly on those issues, stand.
 *   - Volume 1 issues 10-14 and all of Volume 2 set a conventional headline
 *     under a section strap. These read back cleanly, and are usually the only
 *     good title available because their contents pages are the interleaved
 *     kind.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";

const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";

/**
 * Lines that are furniture on every page, not content. The month pattern has
 * an optional year on purpose: the running head is split across lines on most
 * issues, so "Nov-Dec" and "2021" arrive as two separate lines and both have
 * to be recognised or the month leaks into the headline.
 */
const MASTHEAD = [
  /^energy\s*konnect\b/i,
  /^volume\s+[ivx0-9]+/i,
  /^issue\s*[-–]?\s*[ivx0-9]*$/i,
  new RegExp(
    `^(${MONTH})[a-z]*\\.?\\s*[-–—/]?\\s*((${MONTH})[a-z]*\\.?)?\\s*,?\\s*(20\\d{2})?\\.?$`,
    "i",
  ),
  /^20\d{2}$/,
  /^\d{1,3}$/, // a folio on its own line
  /^www\./i,
  /^a step forward in power sector reform/i,
  /^(editorial|advisory)\s+board$/i,
];

/**
 * Section labels as printed on an article's own opening page, normalised to
 * the names used in `MagazineArticle.sectionLabel`. Kept separate from the TOC's
 * table in lib/toc.js: that one matches contents-listing headings, this one
 * matches the strap printed above a headline, and they drift apart — the strap
 * says "Cover Article" and "Feature Story" where the TOC says neither.
 */
const SECTION_STRAPS = [
  [/^about\s+energy\s*konnect$/i, "About"],
  [/^editorial$/i, "Editorial"],
  [/^cover\s+(story|article)$/i, "Cover Story"],
  [/^feature\s+(article|story)s?$/i, "Feature Article"],
  [/^tutorials?$/i, "Tutorial"],
  [/^consumers?'?s?\s+desk$/i, "Consumer Desk"],
  [/^news\s*(and|&)\s*events$/i, "News and Events"],
];

/**
 * Words that never appear in a byline. Their presence is what separates a
 * two-word headline ("Power Crisis") from a two-word name ("Rathin Basu").
 */
const NOT_A_NAME =
  /\b(the|of|and|for|in|on|to|a|an|with|from|through|its|is|are|be|by|at|as|our|new|power|energy|electricity|solar|grid|india|indian|these|this|that)\b/i;

/** "-Mr Arvind S Bakshi", "By Rathin Basu", "‐ Mr Prabhu Shukla". */
const BYLINE_PREFIX = /^[-‐–—]\s*|^(by|mr|mrs|ms|dr|prof|er)\.?\s+/i;

/** Trailing credentials, printed above or below the name depending on issue. */
const AFFILIATION =
  /^(former|formerly|ex[\s.-]|retd|advisor|chairman|director|managing|secretary|professor|editor|energy\s*&|member\b)/i;

/**
 * Words a magazine prints at the top of the body, which `-layout` often pulls
 * onto the last headline line. They are never part of a title.
 */
const BODY_OPENER = /\s+(abstract|introduction|synopsis|summary|background)\b.*$/i;

const tidy = (value) => value.replace(/\s+/g, " ").replace(/­/g, "").trim();

const isMasthead = (line) => MASTHEAD.some((pattern) => pattern.test(line));

function matchStrap(line) {
  const key = tidy(line).replace(/[.:]+$/, "");
  if (key.length > 30) return null;
  const hit = SECTION_STRAPS.find(([pattern]) => pattern.test(key));
  return hit ? hit[1] : null;
}

const isAllCaps = (line) => /[A-Z]/.test(line) && !/[a-z]/.test(line);

/**
 * A byline is short, made of capitalised tokens, and carries no connective
 * words. An explicit prefix ("-Mr", "By") settles it outright — that form is
 * used for names that would otherwise read as prose.
 */
function looksLikeByline(line) {
  const text = tidy(line);
  if (text.length > 70) return false;
  if (/[?!:;]$/.test(text)) return false; // a question is a headline, not a name
  if (BYLINE_PREFIX.test(text)) return true;

  // An all-caps line is headline styling; magazines do not set bylines in caps.
  if (isAllCaps(text)) return false;
  if (NOT_A_NAME.test(text)) return false;

  const tokens = text.replace(/[.,]/g, "").split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return false;
  return tokens.every((token) => /^[A-Z]/.test(token));
}

/**
 * Names are printed either alone or trailed by a credential on the same line
 * ("D Radhakrishna, Chairman Tripura Electricity Regulatory Commission."). The
 * credential belongs to the magazine's own page furniture, not to the article
 * record, so it is cut here rather than stored and trimmed later.
 */
function cleanByline(line) {
  const name = tidy(line)
    .replace(BYLINE_PREFIX, "")
    .split(/\s*[,.]\s+/)[0]
    .replace(/[.,;:]+$/, "")
    .trim();
  if (!name) return null;
  const tokens = name.split(" ").filter(Boolean);
  if (name.length > 60 || tokens.length > 6) return null;
  // Last guard: cutting the credential off can leave a run of prose that read
  // as a name only because the sentence it came from continued past the comma.
  if (NOT_A_NAME.test(name)) return null;
  return name;
}

/** Body copy: too long to be a headline line at any of these issues' sizes. */
const looksLikeBody = (line) => tidy(line).length > 80;

function readPage(issueKey, pageNumber) {
  const file = path.join(
    paths.raw(issueKey),
    "layout",
    `page-${String(pageNumber).padStart(3, "0")}.txt`,
  );
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map(tidy).filter(Boolean);
}

/**
 * Reads the opening page of an article and reports what it could recover.
 *
 * @returns {{headline: string|null, author: string|null, sectionLabel: string|null,
 *            confident: boolean, note: string|null}}
 */
export function readFrontPage(issueKey, startPage) {
  const empty = { headline: null, author: null, sectionLabel: null, confident: false, note: null };

  const lines = readPage(issueKey, startPage);
  if (!lines) return { ...empty, note: "no extracted text for this page" };

  const content = lines.filter((line) => !isMasthead(line));

  // The strap, if printed, marks where the headline starts. Some pages set it
  // on the same physical line as the running head ("Cover Article  ENERGY
  // KONNECT, JUNE 2020"), so match the leading words rather than the whole line.
  let sectionLabel = null;
  let cursor = 0;
  for (let index = 0; index < Math.min(content.length, 6); index += 1) {
    const hit = matchStrap(content[index].split(/\s{2,}/)[0]);
    if (hit) {
      sectionLabel = hit;
      cursor = index + 1;
      break;
    }
  }

  // An editorial has no headline — the page is the masthead credits set beside
  // the leader itself, and every line after the strap is either a board member
  // or body copy. Reading one produces confident-looking nonsense, so stop at
  // the strap and let the caller title it from the issue's own period.
  if (sectionLabel === "Editorial") {
    return { ...empty, sectionLabel, note: null };
  }

  const headlineLines = [];
  let author = null;

  for (; cursor < content.length && headlineLines.length < 4; cursor += 1) {
    const line = content[cursor];

    if (matchStrap(line)) continue; // a repeated strap
    if (looksLikeBody(line)) break; // body copy — the headline never started

    if (looksLikeByline(line)) {
      // A name found before any headline is a masthead credit, not a byline.
      if (headlineLines.length) author = cleanByline(line);
      break;
    }

    headlineLines.push(line);

    // A headline that has closed its own sentence is finished.
    if (/[.?!]$/.test(line)) {
      cursor += 1;
      break;
    }
  }

  // The byline usually sits immediately after the headline, but a credential
  // line comes first on the issues that print it above the name.
  if (!author && headlineLines.length) {
    for (let index = cursor; index < Math.min(cursor + 2, content.length); index += 1) {
      if (looksLikeByline(content[index])) {
        author = cleanByline(content[index]);
        break;
      }
      if (!AFFILIATION.test(content[index])) break;
    }
  }

  const headline = headlineLines.length
    ? tidy(headlineLines.join(" ")).replace(BODY_OPENER, "").trim()
    : null;

  // Confidence is about the *headline*, since that is what overrides the TOC.
  // A strap or a byline beside it is the corroboration that the page was read
  // the way it is set, rather than sliced out of an interleaved column.
  const confident = Boolean(
    headline &&
    headline.length >= 12 &&
    headline.length <= 160 &&
    headlineLines.every((line) => line.length <= 80) &&
    (sectionLabel || author),
  );

  const note = headline
    ? confident
      ? null
      : "headline found but unverified — no section strap or byline beside it"
    : "no headline recoverable from this page";

  return { headline, author, sectionLabel, confident, note };
}

export default readFrontPage;
