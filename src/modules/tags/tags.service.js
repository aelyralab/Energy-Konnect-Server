import ApiError from "../../utils/ApiError.js";
import { uniqueSlug } from "../../utils/slug.js";
import { cached, invalidate } from "../../utils/cache.js";
import * as repo from "./tags.repository.js";

const PUBLIC_CACHE_KEY = "cache:tags:public";
const PUBLIC_CACHE_TTL_SECONDS = 300;

export async function listPublic() {
  return cached(PUBLIC_CACHE_KEY, PUBLIC_CACHE_TTL_SECONDS, () => repo.findAll());
}

export async function listAdmin(query) {
  const { items, total } = await repo.findPage(query);
  return { items, total, page: query.page, limit: query.limit };
}

async function getOrThrow(id) {
  const tag = await repo.findById(id);
  if (!tag) throw ApiError.notFound("Tag not found");
  return tag;
}

export async function create({ name }) {
  const slug = await uniqueSlug(name, repo.slugExists);
  const tag = await repo.create({ name, slug });
  await invalidate(PUBLIC_CACHE_KEY);
  return tag;
}

export async function update(id, data) {
  await getOrThrow(id);

  if (data.slug) {
    const clash = await repo.findBySlug(data.slug);
    if (clash && clash.id !== id) {
      throw ApiError.conflict("A tag with this slug already exists", "DUPLICATE_SLUG");
    }
  }

  const tag = await repo.update(id, data);
  await invalidate(PUBLIC_CACHE_KEY);
  return tag;
}

export async function remove(id) {
  await getOrThrow(id);

  const references = await repo.countReferences(id);
  if (references > 0) {
    throw ApiError.conflict(
      `Cannot delete — ${references} article(s) still use this tag. Remove it from those articles first.`,
      "TAG_IN_USE",
    );
  }

  await repo.remove(id);
  await invalidate(PUBLIC_CACHE_KEY);
}
