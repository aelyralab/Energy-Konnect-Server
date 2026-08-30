/**
 * Picking a category for a PDF-mode article.
 *
 * The block track asks the model for a category name while it is already
 * reading the article. The PDF track never reads the article, so the category
 * has to come from the title and the first page of text — the only two things
 * this track has.
 *
 * Keyword scoring is the right tool for that job and not a compromise: the
 * archive is a trade magazine with a narrow vocabulary, and its seven
 * categories are separated by words that appear in the headline more often than
 * not. Where they do not, the article lands in the fallback and is listed in
 * the review report; changing a category in the CMS is a two-click edit against
 * a live dropdown, unlike the slug.
 *
 * Scoring is deliberately weighted towards the title. A tutorial reprinting a
 * tariff regulation mentions "solar" fifty times in its body without being an
 * article about solar.
 */

/**
 * Ordered most specific first. Bioenergy and Coal are narrow enough to state
 * outright; the broader categories that follow would otherwise absorb them
 * ("coal power plant" scores for Thermal Power too).
 */
const CATEGORY_KEYWORDS = [
  [
    "Bioenergy",
    [
      "biogas",
      "bio-gas",
      "biomass",
      "cow dung",
      "kitchen waste",
      "food waste",
      "food chain waste",
      "bio energy",
      "bioenergy",
      "cattle",
      "compressed biogas",
    ],
  ],
  ["Coal", ["coal", "lignite", "coal india", "coal block", "coal mining", "coal stock"]],
  [
    "Renewable Energy",
    [
      "solar",
      "renewable",
      "rooftop",
      "roof top",
      "roof-top",
      "rts",
      "wind",
      "green hydrogen",
      "hydrogen economy",
      "micro grid",
      "microgrid",
      "mini-grid",
      "mini grid",
      "net zero",
      "energy transition",
      "electric vehicle",
      "ev adoption",
      "mnre",
      "net metering",
      "gross metering",
      "photovoltaic",
      "solar pv",
      "kusum",
    ],
  ],
  [
    "Energy Economics",
    [
      "tariff",
      "cost of supply",
      "economics",
      "price",
      "pricing",
      "investment",
      "viability",
      "ppa",
      "power purchase",
      "subsidy",
      "revenue",
      "least cost",
      "financing",
      "financial",
      "reverse auction",
      "market based",
      "power exchange",
      "cross subsidy",
      "optimising cost",
      "optimizing the cost",
    ],
  ],
  [
    "Thermal Power",
    [
      "thermal",
      "ccgt",
      "gas turbine",
      "heat rate",
      "nuclear",
      "power plant",
      "generation capacity",
      "pump storage",
      "pumped storage",
      "energy storage",
      "smr",
      "boiler",
      "ntpc",
    ],
  ],
  [
    "Electricity & Grid",
    [
      "grid",
      "transmission",
      "distribution",
      "discom",
      "dso",
      "metering",
      "smart meter",
      "prepaid meter",
      "new connection",
      "supply code",
      "load forecasting",
      "power failure",
      "power cut",
      "outage",
      "disaster",
      "reliability",
      "power quality",
      "consumer service",
      "billing",
      "load",
    ],
  ],
  [
    "Energy Policy",
    [
      "policy",
      "bill",
      "act",
      "amendment",
      "regulation",
      "rules",
      "reform",
      "commission",
      "wberc",
      "cerc",
      "serc",
      "mop",
      "ministry of power",
      "privatisation",
      "privatization",
      "licence",
      "license",
      "franchisee",
      "sub licensee",
      "delicence",
      "guidelines",
      "notification",
      "draft",
      "uday",
      "standards of performance",
      "rights of consumers",
    ],
  ],
];

/** Where an article goes when nothing scores. */
const FALLBACK = "Energy Policy";

/**
 * How much louder the title is than the body.
 *
 * High on purpose. Body text in this archive is thick with the whole sector's
 * vocabulary whatever the subject: an article headlined "Climate Challenges for
 * Coal Plants" still says "renewable", "solar" and "net zero" a dozen times, and
 * at a low weight the body drowns out the one word in the headline that names
 * what the piece is actually about. One title hit should beat any amount of
 * background chatter.
 */
const TITLE_WEIGHT = 12;

const count = (haystack, needle) => {
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
};

/**
 * @returns {{categoryName: string, score: number, confident: boolean}}
 */
export function classify(title, bodyText = "") {
  const head = ` ${(title ?? "").toLowerCase()} `;
  const body = ` ${bodyText.toLowerCase().slice(0, 4000)} `;

  const scores = CATEGORY_KEYWORDS.map(([name, keywords]) => {
    let score = 0;
    for (const keyword of keywords) {
      score += count(head, keyword) * TITLE_WEIGHT;
      score += Math.min(count(body, keyword), 3);
    }
    return { name, score };
  }).sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scores;
  if (!best.score) return { categoryName: FALLBACK, score: 0, confident: false };

  // A win only on body mentions, or a photo-finish between two categories, is
  // a guess worth flagging rather than a classification worth trusting.
  const confident = best.score >= TITLE_WEIGHT && best.score >= runnerUp.score + 2;
  return { categoryName: best.name, score: best.score, confident };
}

export default classify;
