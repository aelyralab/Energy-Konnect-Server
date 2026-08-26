/**
 * Running-furniture removal.
 *
 * Every Energy Konnect page carries the same chrome — "ENERGY KONNECT, JUNE
 * 2020", "A step forward in power sector reform", the section label, the folio
 * number. Left in, it costs tokens on every chunk and tempts the model to emit
 * it as a heading block. It is identified statistically rather than by pattern:
 * a line that appears near the top or bottom of many pages is furniture, and
 * that generalises across issues whose chrome differs.
 */

const EDGE_LINES = 3; // how many lines at each end count as "the margin"

const normalize = (line) => line.trim().replace(/\s+/g, " ").toLowerCase();

/** Bare folio numbers, alone on a line. */
const isFolio = (line) => /^\s*\d{1,3}\s*$/.test(line);

/**
 * @param {string[]} pages
 * @returns {Set<string>} normalized lines that recur in the page margins
 */
export function detectFurniture(pages) {
  const counts = new Map();
  for (const page of pages) {
    const lines = page.split(/\r?\n/).filter((line) => line.trim());
    const margin = [...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)];
    // Count each distinct line once per page — a line repeated within one page
    // is not evidence that it is chrome.
    for (const line of new Set(margin.map(normalize))) {
      if (line.length < 4 || isFolio(line)) continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.25));
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([line]) => line));
}

/** Strips detected furniture and bare folios from one page. */
export function stripFurniture(page, furniture) {
  const lines = page.split(/\r?\n/);
  const kept = lines.filter((line, index) => {
    const inMargin = index < EDGE_LINES || index >= lines.length - EDGE_LINES;
    if (!inMargin) return true;
    if (isFolio(line)) return false;
    return !furniture.has(normalize(line));
  });

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Joins words broken across a line by a hyphen, which pdftotext preserves. */
export function dehyphenate(text) {
  return text.replace(/([a-z])-\n([a-z])/g, "$1$2");
}

export function cleanPages(pages) {
  const furniture = detectFurniture(pages);
  return {
    furniture: [...furniture],
    pages: pages.map((page) => dehyphenate(stripFurniture(page, furniture))),
  };
}
