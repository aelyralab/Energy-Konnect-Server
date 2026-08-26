import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

export const createCommentSchema = {
  body: z.object({
    articleId: z.string().uuid(),
    content: z.string().trim().min(1, "Comment cannot be empty").max(5000),
  }),
};

export const idParamSchema = { params: z.object({ id: z.string().uuid() }) };

export const listByArticleQuerySchema = {
  params: z.object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]+$/, "Invalid slug"),
  }),
  query: paginationQuery,
};
