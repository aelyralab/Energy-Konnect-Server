/**
 * Finding where each article begins inside a converted .docx.
 *
 * The DOCX track's original segmenter matches the manifest's article titles
 * against Word's own `Heading1..4` styles, which is exactly right for a document
 * that was authored in Word. It does not work at all on a .docx that Word
 * produced by reflowing a PDF, and the reason is worth stating: Word infers
 * headings from font size, so on these magazines it styles the numbered
 * subheadings buried inside the regulation reprints ("2.1 Form and manner of
 * application") and misses every article headline, because the headlines are
 * display type inside floating frames. On the pilot issue that is 19 headings
 * found and 0 of 7 articles anchored.
 *
 * So this anchors on prose instead. Both files come from the same source
 * document, so the sentences are the same sentences — the PDF track already
 * extracted them page by page, and the plan already says which page each article
 * starts on. Matching a few opening sentences against the element flow puts the
 * boundary within one element, without needing Word to have understood anything.
 *
 * Anchors advance monotonically, for the same reason they do in the heading
 * matcher: an article later in the printed issue cannot start before an earlier
 * one, and a headline repeated on the contents page would otherwise drag it to
 * the front of the document.
 */

/** Punctuation, case and hyphenation all differ between the two extractions. */
export const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Words per probe. Long enough to be unique, short enough to survive a reflow. */
const PROBE_WORDS = 9;

/** Probes are drawn from the article's opening page and the one after it. */
const PROBE_PAGES = 2;

/** How many probes to try before giving up on an article. */
const MAX_PROBES = 14;

/**
 * The document as one normalized string, plus an index from character offset
 * back to the element it came from.
 */
export function buildHaystack(elements) {
  const marks = [];
  let text = "";
  elements.forEach((element, index) => {
    const piece = normalize(element.text ?? "");
    if (!piece) return;
    marks.push({ offset: text.length, index });
    text += `${piece} `;
  });
  return { text, marks };
}

function elementAt(marks, offset) {
  let low = 0;
  let high = marks.length - 1;
  let best = marks.length ? marks[0].index : 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (marks[mid].offset <= offset) {
      best = marks[mid].index;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function offsetOf(marks, elementIndex) {
  const mark = marks.find((entry) => entry.index >= elementIndex);
  return mark ? mark.offset : Infinity;
}

/**
 * Candidate probes from an article's opening pages, longest first.
 *
 * Long lines are preferred because they are prose — a headline or a folio can
 * repeat anywhere in the issue, but a full sentence occurs once.
 */
function probesFor(readPage, startPage, endPage) {
  const lines = [];
  const last = Math.min(endPage, startPage + PROBE_PAGES - 1);
  for (let page = startPage; page <= last; page += 1) {
    const text = readPage(page);
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const words = normalize(line).split(" ").filter(Boolean);
      if (words.length >= PROBE_WORDS) lines.push(words.slice(0, PROBE_WORDS).join(" "));
    }
  }
  return [...new Set(lines)].slice(0, MAX_PROBES);
}

/**
 * Locates each article's first element.
 *
 * @param {object[]} elements  the DOCX element flow
 * @param {{index: number, startPage: number, endPage: number}[]} articles in printed order
 * @param {(page: number) => string|null} readPage  the PDF track's text for one page
 * @returns {{index, position, endPosition, probe, probesMatched, confident}[]}
 */
export function anchorArticles(elements, articles, readPage) {
  const { text, marks } = buildHaystack(elements);

  const anchors = [];
  let floor = 0; // character offset an anchor must not precede

  for (const article of articles) {
    const probes = probesFor(readPage, article.startPage, article.endPage);

    // The earliest match wins, not the first probe that happens to hit: probes
    // come off the page in reading order, but a reflow can move a pull-quote
    // ahead of the paragraph it was pulled from.
    let earliest = null;
    let matched = 0;
    let probeText = null;

    for (const probe of probes) {
      const at = text.indexOf(probe, floor);
      if (at < 0) continue;
      matched += 1;
      if (earliest === null || at < earliest) {
        earliest = at;
        probeText = probe;
      }
    }

    if (earliest === null) {
      anchors.push({
        index: article.index,
        position: null,
        probe: null,
        probesMatched: 0,
        probesTried: probes.length,
        confident: false,
      });
      continue;
    }

    const position = elementAt(marks, earliest);
    anchors.push({
      index: article.index,
      position,
      probe: probeText,
      probesMatched: matched,
      probesTried: probes.length,
      confident: true,
    });

    // Advance past this article's opening element so the next one cannot claim
    // the same prose.
    floor = offsetOf(marks, position + 1);
    if (!Number.isFinite(floor)) floor = text.length;
  }

  placeUnanchored(anchors, articles);

  // Each article runs to the element before the next anchored one.
  return anchors.map((anchor, position) => {
    if (anchor.position === null) return { ...anchor, endPosition: null };
    const next = anchors.slice(position + 1).find((other) => other.position !== null);
    return { ...anchor, endPosition: (next ? next.position : elements.length) - 1 };
  });
}

/**
 * Estimates a position for an article no probe could place.
 *
 * Two things defeat prose matching, and both are real in this archive. A page
 * that is almost entirely a graphic has no sentence to match — the UDAY page in
 * V1_I8 carries five lines, the longest three words. And an article whose
 * opening prose was already consumed by its predecessor's anchor falls behind
 * the monotonic floor and can never match.
 *
 * Leaving it unplaced drops the article from the issue entirely, which is worse
 * than an approximate range: the elements run in the same order as the pages,
 * so interpolating between the neighbours that *did* anchor puts the boundary
 * close and keeps the piece. It is marked unconfident so review.md says so.
 */
function placeUnanchored(anchors, articles) {
  const pageOf = new Map(articles.map((article) => [article.index, article.startPage]));

  for (let index = 0; index < anchors.length; index += 1) {
    if (anchors[index].position !== null) continue;

    const before = [...anchors.slice(0, index)].reverse().find((a) => a.position !== null);
    const after = anchors.slice(index + 1).find((a) => a.position !== null);
    // Nothing to interpolate between at the very start or end of an issue.
    if (!before || !after) continue;

    const fromPage = pageOf.get(before.index);
    const toPage = pageOf.get(after.index);
    const ownPage = pageOf.get(anchors[index].index);
    const span = toPage - fromPage;
    const fraction = span > 0 ? (ownPage - fromPage) / span : 0.5;

    const estimated = Math.round(before.position + fraction * (after.position - before.position));
    anchors[index] = {
      ...anchors[index],
      position: Math.min(Math.max(estimated, before.position + 1), after.position - 1),
      probe: null,
      confident: false,
      estimated: true,
    };
  }
}

export default anchorArticles;
