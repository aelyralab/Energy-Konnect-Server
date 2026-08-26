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

const taxonomyFields = {
  topicIds: z.array(z.string().uuid()).max(20).optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional(),
};

export const reviewQueueQuerySchema = { query: paginationQuery };

export const listQuerySchema = {
  query: paginationQuery.extend({
    status: z.enum(ARTICLE_STATUSES).optional(),
    publisherId: z.string().uuid().optional(),
    q: z.string().trim().min(1).max(200).optional(),
  }),
};

export const idParamSchema = { params: z.object({ id: z.string().uuid() }) };

export const versionIdParamSchema = {
  params: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }),
};

/** Admin creating an article — the same content shape a publisher submits,
 * but authored by/attributed to the admin, and optionally published on
 * creation via ?publish=true (context doc §30). */
export const createArticleSchema = {
  query: z.object({
    publish: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  }),
  body: versionContentSchema.extend(taxonomyFields),
};

export const updateArticleSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: versionContentSchema.extend(taxonomyFields),
};

export const rejectSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reason: z.string().trim().min(1, "A reason is required").max(2000),
  }),
};
