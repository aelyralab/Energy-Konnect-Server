import { z } from "zod";

/** Merge into any list-query schema: `paginationQuery.extend({ ... })`. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function toSkipTake({ page, limit }) {
  return { skip: (page - 1) * limit, take: limit };
}
