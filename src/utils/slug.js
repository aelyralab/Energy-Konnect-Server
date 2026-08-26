/**
 * Slug generation.
 *
 * Article slugs are frozen after first publish (see IMPLEMENTATION_PLAN.md
 * §0.2.3) — this is only ever called once per article, at creation, and
 * separately whenever a taxonomy term (category/topic/tag) or issue is created.
 */

export function slugify(input) {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/**
 * Appends `-2`, `-3`, ... until `exists(candidate)` returns false.
 * @param {string} base
 * @param {(candidate: string) => Promise<boolean>} exists
 */
export async function uniqueSlug(base, exists) {
  const root = slugify(base) || "item";
  let candidate = root;
  let suffix = 2;
  // Sequential by design: each check depends on the previous candidate
  // having been rejected, so it cannot be parallelised.
  while (await exists(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export default slugify;
