import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";
import { versionContentSchema } from "../articleVersions/articleVersions.validation.js";

const ARTICLE_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "PUBLISHED",
  "REJECTED",
  "UNPUBLISHED",
  "ARCHIVED",
];

// Topics/tags are article-level, not versioned (IMPLEMENTATION_PLAN.md
// §0.2.2) — set alongside version content in the same create/update payload,
// but written straight onto the Article row, never onto the version.
const taxonomyFields = {
  topicIds: z.array(z.string().uuid()).max(20).optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional(),
};

export const listQuerySchema = {
  query: paginationQuery.extend({ status: z.enum(ARTICLE_STATUSES).optional() }),
};

export const createArticleSchema = {
  body: versionContentSchema.extend(taxonomyFields),
};

export const updateArticleSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: versionContentSchema.extend(taxonomyFields),
};

export const idParamSchema = {
  params: z.object({ id: z.string().uuid() }),
};
