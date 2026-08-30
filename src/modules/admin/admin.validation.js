import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";
import {
  versionContentShape,
  withContentModeRule,
} from "../articleVersions/articleVersions.validation.js";

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

/** Admin-only: file the article into a magazine. `issueId: null` detaches
 * it; omitting the field leaves the current attachment untouched. Wire
 * field stays `issueId` — only the entity it points at was renamed. */
const magazineFields = {
  issueId: z.string().uuid().nullable().optional(),
  sectionLabel: z.string().trim().max(120).nullable().optional(),
};

export const reviewQueueQuerySchema = { query: paginationQuery };

export const listQuerySchema = {
  query: paginationQuery.extend({
    status: z.enum(ARTICLE_STATUSES).optional(),
    publisherId: z.string().uuid().optional(),
    q: z.string().trim().min(1).max(200).optional(),
    magazineId: z.string().uuid().optional(),
    volume: z.coerce.number().int().positive().optional(),
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
  body: withContentModeRule(versionContentShape.extend({ ...taxonomyFields, ...magazineFields })),
};

export const updateArticleSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: withContentModeRule(versionContentShape.extend({ ...taxonomyFields, ...magazineFields })),
};

export const rejectSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reason: z.string().trim().min(1, "A reason is required").max(2000),
  }),
};
