import ApiError from "../../utils/ApiError.js";
import * as repo from "./archive.repository.js";

export async function listPublished(query) {
  const { items, total } = await repo.findPublishedList(query);
  return { items, total, page: query.page, limit: query.limit };
}

export async function getPublishedBySlug(slug) {
  const magazine = await repo.findPublishedBySlug(slug);
  if (!magazine) throw ApiError.notFound("Magazine not found");
  return magazine;
}
