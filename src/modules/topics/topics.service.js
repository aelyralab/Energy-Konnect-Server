import ApiError from "../../utils/ApiError.js";
import { uniqueSlug } from "../../utils/slug.js";
import { cached, invalidate } from "../../utils/cache.js";
import * as repo from "./topics.repository.js";

const PUBLIC_CACHE_KEY = "cache:topics:public";
const PUBLIC_CACHE_TTL_SECONDS = 300;

export async function listPublic() {
  return cached(PUBLIC_CACHE_KEY, PUBLIC_CACHE_TTL_SECONDS, () => repo.findAllActive());
}

export async function listAdmin(query) {
  const { items, total } = await repo.findAll(query);
  return { items, total, page: query.page, limit: query.limit };
}

async function getOrThrow(id) {
  const topic = await repo.findById(id);
  if (!topic) throw ApiError.notFound("Topic not found");
  return topic;
}

export async function create({ name, description, isActive }) {
  const slug = await uniqueSlug(name, repo.slugExists);
  const topic = await repo.create({ name, slug, description, isActive });
  await invalidate(PUBLIC_CACHE_KEY);
  return topic;
}

export async function update(id, data) {
  await getOrThrow(id);

  if (data.slug) {
    const clash = await repo.findBySlug(data.slug);
    if (clash && clash.id !== id) {
      throw ApiError.conflict("A topic with this slug already exists", "DUPLICATE_SLUG");
    }
  }

  const topic = await repo.update(id, data);
  await invalidate(PUBLIC_CACHE_KEY);
  return topic;
}

export async function remove(id) {
  await getOrThrow(id);

  const references = await repo.countReferences(id);
  if (references > 0) {
    throw ApiError.conflict(
      `Cannot delete — ${references} article(s) still use this topic. Deactivate it instead.`,
      "TOPIC_IN_USE",
    );
  }

  await repo.remove(id);
  await invalidate(PUBLIC_CACHE_KEY);
}
