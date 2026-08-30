/**
 * Reading-time estimate for a version's content blocks.
 *
 * Recomputed by the article service on every save (surfaces on the client as
 * "11 min read", per IMPLEMENTATION_PLAN.md §0.3). 200 words/minute is the
 * commonly used estimate for adult reading of non-technical prose; rounded up
 * so short sections never claim "0 min read".
 */
const WORDS_PER_MINUTE = 200;

/** Extracts the visible words from one block, independent of its type. */
function wordsInBlock(block) {
  const data = block?.content ?? block?.data ?? block;
  if (!data || typeof data !== "object") return 0;

  const parts = [];
  if (typeof data.text === "string") parts.push(data.text);
  if (typeof data.title === "string") parts.push(data.title);
  if (typeof data.caption === "string") parts.push(data.caption);
  if (typeof data.attribution === "string") parts.push(data.attribution);
  if (typeof data.note === "string") parts.push(data.note);
  if (typeof data.expression === "string") parts.push(data.expression);
  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      if (typeof item === "string") parts.push(item);
      else if (item && typeof item.label === "string") parts.push(item.label);
    }
  }
  if (Array.isArray(data.rows)) {
    for (const row of data.rows) {
      if (Array.isArray(row)) parts.push(row.join(" "));
    }
  }
  if (Array.isArray(data.columns)) parts.push(data.columns.join(" "));

  const text = parts.join(" ").trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

/** @param {Array<{content?: object, data?: object}>} blocks */
export function estimateReadingMinutes(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return 1;
  const totalWords = blocks.reduce((sum, block) => sum + wordsInBlock(block), 0);
  return Math.max(1, Math.ceil(totalWords / WORDS_PER_MINUTE));
}

// A magazine page carries roughly 2 minutes of reading at normal pace —
// denser than a web article's block text, since it includes sidebars,
// pull-quotes and captions the block estimate above would count separately.
const MINUTES_PER_PDF_PAGE = 2;

/** @param {number | null | undefined} pageCount */
export function estimateReadingMinutesFromPageCount(pageCount) {
  if (!pageCount || pageCount < 1) return 1;
  return Math.max(1, Math.round(pageCount * MINUTES_PER_PDF_PAGE));
}

export default estimateReadingMinutes;
