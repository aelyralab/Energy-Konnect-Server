import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

export const listQuerySchema = { query: paginationQuery };

export const slugParamSchema = {
  params: z.object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]+$/, "Invalid slug"),
  }),
};
