import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

const slugParam = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+$/, "Invalid slug");

export const listQuerySchema = {
  query: paginationQuery.extend({
    category: slugParam.optional(),
    topic: slugParam.optional(),
    tag: slugParam.optional(),
    issue: slugParam.optional(),
    featured: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
    sort: z.enum(["latest", "oldest"]).default("latest"),
  }),
};

export const slugParamSchema = {
  params: z.object({ slug: slugParam }),
};
