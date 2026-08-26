/**
 * Issue metadata and article segmentation.
 *
 * Three independent signals are combined, because none is reliable alone:
 *   1. The cover line ("Volume II Issue 17   July-Aug. 2022") — volume, issue,
 *      period. Absent or mangled on a few covers, so the filename is a fallback.
 *   2. The Table of Contents — article titles and their *printed* start pages.
 *   3. The printed folio in each page's margin — the offset between printed
 *      page numbers and PDF page indices.
 *
 * Everything emitted here carries a confidence flag. A manifest that comes out
 * "review" is not wrong, it is unverified — segment.js writes it out for a
 * human to glance at rather than guessing silently.
 */

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

const MONTH = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const PERIOD_RE = new RegExp(
  `((?:${MONTH})[a-z]*\\.?\\s*(?:[-–—/]\\s*(?:${MONTH})[a-z]*\\.?)?)\\s*,?\\s*(20\\d{2})`,
  "i",
);

/**
 * Section labels as printed. Matching against a known list beats an all-caps
 * heuristic: Volume 1 prints them in caps ("COVER ARTICLE"), Volume 2 in title
 * case ("Cover Story"), and a title in caps would otherwise be misread.
 *
 * The right-hand value is what goes into IssueArticle.sectionLabel, normalised
 * to the five labels named in schema.prisma.
 */
const SECTIONS = [
  ["about energy konnect", "About"],
  ["editorial", "Editorial"],
  ["cover article", "Cover Story"],
  ["cover story", "Cover Story"],
  ["feature articles", "Feature Article"],
  ["feature article", "Feature Article"],
  ["feature story", "Feature Article"],
  ["tutorial", "Tutorial"],
  ["consumers desk", "Consumer Desk"],
  ["consumer desk", "Consumer Desk"],
  ["consumers' desk", "Consumer Desk"],
  ["news and events", "News and Events"],
  ["news & events", "News and Events"],
];

const norm = (line) =>
  line
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.:]+$/, "")
    .toLowerCase();

function matchSection(line) {
  const key = norm(line).replace(/[’]/g, "'");
  if (key.length > 40) return null; // a long line is a title, not a label
  const hit = SECTIONS.find(([needle]) => key === needle);
  return hit ? hit[1] : null;
}

function romanOrArabic(token) {
  const key = token.toLowerCase();
  if (ROMAN[key] !== undefined) return ROMAN[key];
  const parsed = Number.parseInt(token, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

// ---------------------------------------------------------------------------
// Cover metadata
// ---------------------------------------------------------------------------

export function parseCover(pages, fileName, volumeFolder) {
  const head = pages.slice(0, 3).join("\n");
  const notes = [];

  let volumeNumber = null;
  let issueNumber = null;
  const cover = /Volume\s+([IVXivx]+|\d+)\s*[,\s]\s*Issue\s+(\d+)/i.exec(head);
  if (cover) {
    volumeNumber = romanOrArabic(cover[1]);
    issueNumber = Number.parseInt(cover[2], 10);
  }

  // Filenames encode the same thing ("V1_I2 draft electricity bill.pdf").
  const fromName = /^V(\d+)(?:[_\s]*I(\d+))?/i.exec(fileName);
  const nameVolume = fromName ? Number.parseInt(fromName[1], 10) : null;
  const nameIssue = fromName?.[2] ? Number.parseInt(fromName[2], 10) : null;

  // The folder ("Volume 1" / "Volume 2") is the most reliable of the three —
  // it was chosen by a human who was looking at the whole set.
  // Anchored on the word "Volume" — a bare /[IVX]+/ matches the V of "Volume"
  // itself and reads "Volume 1" as roman numeral V.
  const folderVolume = romanOrArabic(/volume\s*(\d+|[IVX]+)/i.exec(volumeFolder ?? "")?.[1] ?? "");

  // V1_I14's cover reads "Volume 11 Issue 14" — a typo in the source PDF.
  // Where the cover disagrees with corroborating evidence, the cover loses.
  for (const [source, value] of [
    ["filename", nameVolume],
    ["folder", folderVolume],
  ]) {
    if (value !== null && volumeNumber !== null && value !== volumeNumber) {
      notes.push(`cover says Volume ${volumeNumber}, ${source} says ${value} — using ${value}`);
      volumeNumber = value;
    }
  }
  if (volumeNumber === null) volumeNumber = nameVolume ?? folderVolume;

  if (nameIssue !== null && issueNumber !== null && nameIssue !== issueNumber) {
    notes.push(`cover says Issue ${issueNumber}, filename says ${nameIssue} — using ${nameIssue}`);
    issueNumber = nameIssue;
  }
  if (issueNumber === null) issueNumber = nameIssue;

  const period = PERIOD_RE.exec(head);

  return {
    volumeNumber,
    issueNumber,
    period: period ? `${period[1].replace(/\s+/g, "")} ${period[2]}`.trim() : null,
    coverTitle: guessCoverTitle(pages[0] ?? ""),
    notes,
  };
}

/**
 * The cover's display title: the text before the TOC that is neither the
 * masthead nor the volume line. Heuristic and often imperfect — `theme` is
 * optional on PublicationIssue, so a miss costs nothing.
 */
function guessCoverTitle(firstPage) {
  const lines = firstPage.split(/\r?\n/).map((line) => line.trim());
  const stop = lines.findIndex((line) => /table of contents/i.test(line));
  const candidates = (stop === -1 ? lines : lines.slice(0, stop))
    .filter((line) => line.length > 3)
    .filter((line) => !/energy konnect/i.test(line))
    .filter((line) => !/volume|issue/i.test(line))
    .filter((line) => !PERIOD_RE.test(line))
    .filter((line) => !/^\d+$/.test(line));
  return candidates.slice(0, 3).join(" ").replace(/\s+/g, " ").trim() || null;
}

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

const TOC_MARKER = /table of contents?/i; // V1_I7 prints "Table of Content"

/** A line ending in a plausible printed page number closes a TOC entry. */
const anchorOf = (line, pageCount) => {
  const match = /^(.*?)\s+(\d{1,3})$/.exec(line);
  if (!match) return null;
  const folio = Number.parseInt(match[2], 10);
  return folio >= 1 && folio <= pageCount ? { text: match[1], folio } : null;
};

/**
 * Locates the TOC. The "Table of Contents" heading is used when present, but it
 * is not required — V1_I6 prints its contents list on the cover with no heading
 * at all. The fallback is structural: the first of the opening pages carrying
 * at least three lines that end in a plausible page number.
 */
function findToc(pages) {
  const window = pages.slice(0, 4);

  const labelled = window.findIndex((page) => TOC_MARKER.test(page));
  if (labelled !== -1) return { index: labelled, hadMarker: true };

  const structural = window.findIndex((page) => {
    const anchors = page.split(/\r?\n/).filter((line) => anchorOf(line.trim(), pages.length));
    return anchors.length >= 3;
  });
  return structural === -1
    ? { index: null, hadMarker: false }
    : { index: structural, hadMarker: false };
}

/**
 * Entries are accumulated line by line. A line ending in a number closes the
 * current entry with that number as its printed start page; a line matching a
 * known section label opens a new section.
 *
 * Titles that wrap *after* the page number — Volume 2 right-aligns the number
 * mid-entry, so "Solar Rooftop Policies & Regulations in 11 / Gujarat" loses
 * "Gujarat" — come out truncated, and the buffer is deliberately capped at two
 * lines so an orphaned fragment cannot bleed into the next entry. That is
 * acceptable: the TOC title only has to be good enough to *segment* on. The
 * title that reaches the database is read off the article's own opening page by
 * stage 3, which sees the real headline.
 */
export function parseToc(pages) {
  const { index: tocPageIndex, hadMarker } = findToc(pages);
  if (tocPageIndex === null) return { entries: [], tocPageIndex: null, hadMarker };

  // A TOC occasionally runs onto the following page.
  const region = pages.slice(tocPageIndex, tocPageIndex + 2).join("\n");
  const body = hadMarker ? region.split(TOC_MARKER).slice(1).join("\n") : region;

  const entries = [];
  let section = null;
  let buffer = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("*")) continue; // "* News and Events at the back of the magazine"

    const label = matchSection(line);
    if (label) {
      section = label;
      buffer = [];
      continue;
    }

    const anchor = anchorOf(line, pages.length);
    if (anchor) {
      const title = [...buffer, anchor.text].join(" ").replace(/\s+/g, " ").trim().slice(0, 160);
      buffer = [];
      if (title.length >= 3) {
        // "Editorial   4" is both an entry and its own section — the TOC never
        // prints a separate "EDITORIAL" heading above it.
        const selfLabel = matchSection(anchor.text);
        entries.push({
          sectionLabel: selfLabel ?? section ?? "Feature Article",
          title,
          startFolio: anchor.folio,
        });
      }
      continue;
    }

    buffer.push(line);
    if (buffer.length > 2) buffer.shift(); // keep only the lines nearest the anchor
  }

  return { entries, tocPageIndex, hadMarker };
}

// ---------------------------------------------------------------------------
// Printed folio -> PDF page index
// ---------------------------------------------------------------------------

/**
 * Returns the dominant `printedFolio - pdfIndex` offset, plus how much of the
 * issue agrees with it. A low agreement ratio is the signal that a manifest
 * needs human eyes.
 */
export function folioOffset(pages) {
  const votes = new Map();
  let observed = 0;

  pages.forEach((page, index) => {
    const lines = page.split(/\r?\n/).filter((line) => line.trim());
    const margin = [...lines.slice(0, 2), ...lines.slice(-2)];
    for (const line of margin) {
      const folio = /^\s*(\d{1,3})\s*$/.exec(line);
      if (!folio) continue;
      const offset = Number.parseInt(folio[1], 10) - (index + 1);
      votes.set(offset, (votes.get(offset) ?? 0) + 1);
      observed += 1;
      break;
    }
  });

  if (!observed) return { offset: 0, agreement: 0, observed: 0 };

  // Agreement is measured against the pages that actually showed a folio, not
  // against every page. Plenty of pages legitimately print no number (full-page
  // figures, the cover, section openers), and counting those as disagreement
  // flagged every issue in the corpus for review.
  const [offset, count] = [...votes].sort((a, b) => b[1] - a[1])[0];
  return { offset, agreement: count / observed, observed };
}

// ---------------------------------------------------------------------------
// Article ranges
// ---------------------------------------------------------------------------

/**
 * Turns TOC entries into 1-indexed inclusive PDF page ranges. Each article runs
 * from its own start to the page before the next one starts.
 */
export function resolveRanges(entries, offset, pageCount) {
  const sorted = [...entries]
    .map((entry) => ({ ...entry, startPage: entry.startFolio - offset }))
    .filter((entry) => entry.startPage >= 1 && entry.startPage <= pageCount)
    .sort((a, b) => a.startPage - b.startPage);

  return sorted.map((entry, index) => {
    const next = sorted[index + 1];
    return {
      ...entry,
      endPage: next ? Math.max(entry.startPage, next.startPage - 1) : pageCount,
    };
  });
}

export { SECTIONS };
