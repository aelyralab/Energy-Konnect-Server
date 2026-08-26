import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

const name = z.string().trim().min(1, "Name is required").max(120);
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
    search: z.string().trim().min(1).max(120).optional(),
  }),
};

export const createSchema = {
  body: z.object({
    name,
    description: z.string().trim().max(2000).optional(),
    isActive: z.boolean().default(true),
  }),
};

export const updateSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      name: name.optional(),
      slug: slug.optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      isActive: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: "No changes provided" }),
};

export const idParamSchema = {
  params: z.object({ id: z.string().uuid() }),
};
