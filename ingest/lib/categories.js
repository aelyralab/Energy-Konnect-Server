/**
 * The category vocabulary the model may choose from.
 *
 * Mirrors the CATEGORIES list in prisma/seed.js. It is a *starting* list, not
 * the authority: stage 5 fetches the live categories from the API and matches
 * on name, so a category renamed or added in the CMS wins. A name the model
 * returns that has no live match is reported, not silently dropped.
 */
export const CATEGORY_NAMES = [
  "Renewable Energy",
  "Thermal Power",
  "Energy Policy",
  "Electricity & Grid",
  "Energy Economics",
  "Bioenergy",
  "Coal",
];

/** Case- and punctuation-insensitive match, so "Electricity and Grid" resolves. */
export function matchCategory(name, liveCategories) {
  if (!name) return null;
  const key = (value) =>
    value
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "");
  return liveCategories.find((category) => key(category.name) === key(name)) ?? null;
}

export default CATEGORY_NAMES;
