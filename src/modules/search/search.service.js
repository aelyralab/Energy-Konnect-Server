import * as repo from "./search.repository.js";

export async function search(query) {
  const { items, total } = await repo.search(query);
  return { items, total, page: query.page, limit: query.limit };
}
