import ApiError from "../../utils/ApiError.js";
import * as repo from "./publications.repository.js";

export async function listPublished(query) {
  const { items, total } = await repo.findPublishedList(query);
  return { items, total, page: query.page, limit: query.limit };
}

export async function getPublishedBySlug(slug) {
  const issue = await repo.findPublishedBySlug(slug);
  if (!issue) throw ApiError.notFound("Publication issue not found");
  return issue;
}
