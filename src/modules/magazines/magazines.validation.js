import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";
import { blocksArraySchema } from "../../utils/blockSchemas.js";

export const listQuerySchema = {
  query: paginationQuery.extend({
    q: z.string().trim().min(1).max(200).optional(),
  }),
};

export const idParamSchema = { params: z.object({ id: z.string().uuid() }) };

// The editorial is a first-class part of the magazine — same block shape an
// article body uses (validated by the same blocksArraySchema), just stored
// as JSONB on the magazine row instead of an ArticleContentBlock table,
// since it is always exactly one per magazine and never versioned.
const editorialFields = {
  editorialTitle: z.string().trim().max(300).optional(),
  editorialAuthor: z.string().trim().max(200).optional(),
  editorialSummary: z.string().trim().max(2000).optional(),
  editorialBody: blocksArraySchema.optional(),
};

export const createMagazineSchema = {
  body: z.object({
    volumeNumber: z.number().int().positive(),
    issueNumber: z.number().int().positive(),
    title: z.string().trim().min(1, "Title is required").max(300),
    period: z.string().trim().max(120).optional(),
    theme: z.string().trim().max(300).optional(),
    description: z.string().trim().max(2000).optional(),
    coverMediaId: z.string().uuid().optional(),
    pdfMediaId: z.string().uuid().optional(),
    ...editorialFields,
  }),
};

export const updateMagazineSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      volumeNumber: z.number().int().positive().optional(),
      issueNumber: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(300).optional(),
      period: z.string().trim().max(120).nullable().optional(),
      theme: z.string().trim().max(300).nullable().optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      coverMediaId: z.string().uuid().nullable().optional(),
      pdfMediaId: z.string().uuid().nullable().optional(),
      editorialTitle: z.string().trim().max(300).nullable().optional(),
      editorialAuthor: z.string().trim().max(200).nullable().optional(),
      editorialSummary: z.string().trim().max(2000).nullable().optional(),
      editorialBody: blocksArraySchema.nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: "No changes provided" }),
};

// An editorial is a first-class part of the magazine (Magazine.editorial*),
// not an article any more — this is the guard mentioned in the migration
// that keeps one from being re-created accidentally.
const NOT_EDITORIAL = {
  message: '"Editorial" is no longer an article section — edit the magazine\'s Editorial panel',
};

export const attachArticleSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    articleId: z.string().uuid(),
    sectionLabel: z
      .string()
      .trim()
      .max(120)
      .refine((value) => value.toLowerCase() !== "editorial", NOT_EDITORIAL)
      .optional(),
    displayOrder: z.number().int().nonnegative().default(0),
  }),
};

export const reorderSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    articles: z
      .array(
        z.object({
          articleId: z.string().uuid(),
          displayOrder: z.number().int().nonnegative(),
          sectionLabel: z
            .string()
            .trim()
            .max(120)
            .refine((value) => value.toLowerCase() !== "editorial", NOT_EDITORIAL)
            .optional(),
        }),
      )
      .min(1),
  }),
};

export const detachArticleSchema = {
  params: z.object({ id: z.string().uuid(), articleId: z.string().uuid() }),
};
