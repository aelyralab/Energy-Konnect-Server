/**
 * Choosing the title and author a PDF-mode article is created with.
 *
 * Two sources disagree and neither is reliable on its own: the printed table
 * of contents (lib/toc.js, via the stage 2 manifest) and the article's own
 * opening page (lib/frontpage.js). Which one is trustworthy flips partway
 * through the archive — Volume 1's early issues have clean contents pages and
 * unreadable pull-quote headlines, the later issues have the reverse — so the
 * choice is made per article, on evidence, and every article that had to fall
 * back to a weak source is reported for review before anything is written.
 *
 * The title matters more here than it does in the block track: it becomes the
 * slug, and slugs are the one thing in this migration that is awkward to change
 * afterwards.
 */

/** Ligatures survive extraction as single codepoints; expand them to letters. */
const LIGATURES = [
  [/ﬀ/g, "ff"],
  [/ﬁ/g, "fi"],
  [/ﬂ/g, "fl"],
  [/ﬃ/g, "ffi"],
  [/ﬄ/g, "ffl"],
  [/‘|’/g, "'"],
  [/“|”/g, '"'],
];

/** Magazine furniture that is never an article title, however it was parsed. */
const FURNITURE = [
  // Not anchored: the strapline is the magazine's own subtitle and turns up
  // welded to a real title ("Chandigarh A Step forward in power sector reform")
  // wherever the contents page interleaved two columns.
  /a step forward in power sector reform/i,
  /^volume\s+[ivx0-9]/i,
  /^issue\b/i,
  /^contents?$/i,
  // Unanchored: the running head lands in the middle of a "headline" whenever
  // -layout read across a two-column page ("Cover Article ENERGY KONNECT,
  // JULY-AUGUST 2020 Is Financial Engineering more...").
  /energy\s*konnect/i,
  /^news vistas/i,
  /^(figure|fig\.|table|chart|source:|photo)\b/i,
  /^(cover story|cover article|feature article|feature story|tutorial|consumers? desk|about)$/i,
];

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "nor",
  "of",
  "on",
  "onto",
  "or",
  "over",
  "the",
  "to",
  "up",
  "via",
  "with",
]);

/**
 * Recasing a caps headline destroys the acronyms inside it — "DRAFT NEP 2021"
 * becomes "Draft Nep 2021". This archive's vocabulary is small and closed, so
 * naming the acronyms outright is both accurate and reviewable, where a rule
 * ("keep short caps tokens") would mangle real words like "COST" and "PLAN".
 */
const ACRONYMS = new Set([
  "abeca",
  "ai",
  "bee",
  "berc",
  "cagr",
  "ccgt",
  "cea",
  "cerc",
  "cpp",
  "css",
  "der",
  "discom",
  "dsl",
  "dso",
  "ev",
  "faq",
  "gst",
  "gtam",
  "hvdc",
  "ipp",
  "kusum",
  "lcp",
  "led",
  "mbed",
  "mnre",
  "mop",
  "mou",
  "mw",
  "nep",
  "npo",
  "ntpc",
  "pli",
  "posoco",
  "ppa",
  "pv",
  "r&d",
  "resco",
  "rts",
  "serc",
  "smr",
  "sop",
  "tod",
  "uday",
  "ups",
  "wberc",
]);

export function expandLigatures(value) {
  return LIGATURES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

/**
 * Did `-layout` interleave two columns into this string?
 *
 * The signature is unmistakable once seen: characters from two texts alternate
 * inside single words ("InMduesettriyng" is "Industry" and "Meeting"), which
 * shows up as repeated case flips mid-word, or as doubled letters throughout
 * when the two columns held the same text ("AAbboouuttEEnneerrggyy").
 */
export function isGarbled(title) {
  if (!title) return true;
  const text = expandLigatures(title).trim();

  if (text.length < 8) return true;
  if (FURNITURE.some((pattern) => pattern.test(text))) return true;

  // A title that opens in lower case is a slice out of the middle of a
  // sentence — either a contents entry that ran on from the line above it, or
  // body copy mistaken for a headline.
  if (/^[a-z]/.test(text)) return true;

  // ...and one that ends on a conjunction or a preposition was cut out of the
  // middle of one ("Indian power sector is in its most critical turning point,
  // if properly planned and").
  if (/\b(and|or|but|the|of|in|to|for|with|from|at|on|by|is|are|a|an|that|which)$/i.test(text)) {
    return true;
  }

  const words = text.split(/\s+/);

  // The longest real headline in this archive runs to 122 characters. Past
  // that, body copy has been swept in behind it.
  if (text.length > 140 || words.length > 22) return true;

  // Two texts woven letter by letter: near every character has a twin beside it.
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 10) {
    let doubled = 0;
    for (let index = 1; index < letters.length; index += 1) {
      if (letters[index].toLowerCase() === letters[index - 1].toLowerCase()) doubled += 1;
    }
    if (doubled / letters.length > 0.4) return true;
  }

  // Two words woven together make one impossible word — too long to be English
  // ("DCeocvaerbroSntisoartyion" is "Decarbonisation" and "Cover Story"), or
  // carrying a capital where the second text's word began.
  if (words.some((word) => word.length > 16 || (word.length > 10 && /[a-z][A-Z]/.test(word)))) {
    return true;
  }

  // A contents page prints a page number beside every entry. One that has ended
  // up inside a long title means two entries were read as one.
  if (words.length >= 8 && words.slice(1).some((word) => /^\d{2,3}$/.test(word))) return true;

  // A section strap in the middle of a title is the neighbouring column, for
  // the same reason ("...modernization and EV adoption Consumers Desk Thermal
  // Energy Storage").
  if (
    /\S\s+(cover (story|article)|feature (article|story)|consumers? desk|tutorial|editorial)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Headlines are often set in caps. Stored as-is they shout in every listing, so
 * caps-only titles are recased; anything with real lower case is left alone,
 * because the magazine's own capitalisation is better than a guess.
 */
export function normaliseCase(title) {
  const text = title.trim();
  const lower = (text.match(/[a-z]/g) ?? []).length;
  const upper = (text.match(/[A-Z]/g) ?? []).length;
  if (upper === 0 || lower / (lower + upper) > 0.2) return text;

  return text
    .toLowerCase()
    .split(/(\s+|[-–—/])/)
    .map((token, index, all) => {
      if (!/[a-z]/.test(token)) return token;
      const isEdge = index === 0 || index === all.length - 1;
      // Tokens arrive with their punctuation attached ("(lcp)", "2021:"), so
      // the lookups are done on the bare word and the punctuation restored.
      const bare = token.replace(/[^a-z0-9&]/g, "");
      if (ACRONYMS.has(bare)) return token.replace(bare, bare.toUpperCase());
      if (!isEdge && SMALL_WORDS.has(bare)) return token;
      return token.replace(/[a-z]/, (first) => first.toUpperCase());
    })
    .join("");
}

const clean = (value) =>
  expandLigatures(value)
    .replace(/^REPRINT\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[-–—\s]+|[\s,;:]+$/g, "")
    .trim();

/** Do two titles name the same article? Compared on their content words. */
function overlaps(left, right) {
  const words = (value) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 3 && !SMALL_WORDS.has(word)),
    );
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return true; // nothing to disagree about
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size) >= 0.34;
}

/**
 * Picks the title, and says how sure it is.
 *
 * @returns {{title: string|null, source: string, needsReview: boolean, reason: string|null}}
 */
export function chooseTitle({ tocTitle, front, sectionLabel, period }) {
  // An editorial is titled by its issue, not by its page: the leader carries no
  // headline, and "Editorial" alone would collide across all 21 issues — which
  // uniqueSlug would silently resolve to editorial-2, editorial-3, and so on.
  if (sectionLabel === "Editorial") {
    return {
      title: period ? `Editorial — ${period}` : "Editorial",
      source: "issue",
      needsReview: false,
      reason: null,
    };
  }

  const headline = front.headline ? clean(front.headline) : null;
  const toc = tocTitle ? clean(tocTitle) : null;

  if (headline && front.confident && !isGarbled(headline)) {
    // Both sources readable but describing different articles means the page
    // ranges and the contents listing have drifted apart, and one of them is
    // pointing at the wrong pages. Which one is not decidable from here.
    const conflict = toc && !isGarbled(toc) && !overlaps(headline, toc);
    return {
      title: normaliseCase(headline),
      source: "front page",
      needsReview: Boolean(conflict),
      reason: conflict ? `the contents page calls these pages "${toc}"` : null,
    };
  }
  if (toc && !isGarbled(toc)) {
    return { title: normaliseCase(toc), source: "contents", needsReview: false, reason: null };
  }
  if (headline && !isGarbled(headline)) {
    return {
      title: normaliseCase(headline),
      source: "front page (unverified)",
      needsReview: true,
      reason: "the contents entry is unusable and the headline had nothing corroborating it",
    };
  }

  return {
    title: null,
    source: "none",
    needsReview: true,
    reason: "neither the contents entry nor the opening page yielded a usable title",
  };
}

/**
 * The archive's articles are largely unsigned — the magazine credits its
 * editorial board on the masthead rather than per piece. Where no byline is
 * printed the publication itself is the author, which is both true and what
 * the CMS needs, since authorName is required.
 */
export const HOUSE_AUTHOR = "Energy Konnect";

export function chooseAuthor(front) {
  const name = front.author ? clean(front.author) : null;
  return name && name.length >= 3 ? name : HOUSE_AUTHOR;
}

export default chooseTitle;
