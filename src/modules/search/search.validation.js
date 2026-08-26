import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

const slugFilter = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+$/, "Invalid slug");

export const searchQuerySchema = {
  query: paginationQuery.extend({
    q: z.string().trim().min(1, "A search query is required").max(200),
    category: slugFilter.optional(),
    topic: slugFilter.optional(),
    tag: slugFilter.optional(),
  }),
};
