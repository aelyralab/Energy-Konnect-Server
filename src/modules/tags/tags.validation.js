import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

const name = z.string().trim().min(1, "Name is required").max(80);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Slug must be lowercase, alphanumeric words separated by hyphens",
  );

export const adminListSchema = {
  query: paginationQuery.extend({
    search: z.string().trim().min(1).max(80).optional(),
  }),
};

export const createSchema = {
  body: z.object({ name }),
};

export const updateSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      name: name.optional(),
      slug: slug.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: "No changes provided" }),
};

export const idParamSchema = {
  params: z.object({ id: z.string().uuid() }),
};
