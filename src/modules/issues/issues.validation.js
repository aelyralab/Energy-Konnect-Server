import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

export const listQuerySchema = { query: paginationQuery };

export const idParamSchema = { params: z.object({ id: z.string().uuid() }) };

export const createIssueSchema = {
  body: z.object({
    volumeNumber: z.number().int().positive(),
    issueNumber: z.number().int().positive(),
    title: z.string().trim().min(1, "Title is required").max(300),
    period: z.string().trim().max(120).optional(),
    theme: z.string().trim().max(300).optional(),
    description: z.string().trim().max(2000).optional(),
    coverMediaId: z.string().uuid().optional(),
    pdfMediaId: z.string().uuid().optional(),
  }),
};

export const updateIssueSchema = {
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
    })
    .refine((data) => Object.keys(data).length > 0, { message: "No changes provided" }),
};

export const attachArticleSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    articleId: z.string().uuid(),
    sectionLabel: z.string().trim().max(120).optional(),
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
          sectionLabel: z.string().trim().max(120).optional(),
        }),
      )
      .min(1),
  }),
};

export const detachArticleSchema = {
  params: z.object({ id: z.string().uuid(), articleId: z.string().uuid() }),
};
