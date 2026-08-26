import asyncHandler from "../../utils/asyncHandler.js";
import { sendCreated, sendPaginated, sendNoContent } from "../../utils/respond.js";
import { serializeComment } from "../../utils/serializers/comment.serializer.js";
import * as commentsService from "./comments.service.js";

/** POST /api/comments */
export const create = asyncHandler(async (req, res) => {
  const comment = await commentsService.create(req.user.id, req.body);
  return sendCreated(res, serializeComment(comment));
});

/** GET /api/articles/:slug/comments */
export const listForArticle = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await commentsService.listForArticleSlug(
    req.params.slug,
    req.query,
  );
  return sendPaginated(res, items.map(serializeComment), { page, limit, total });
});

/** DELETE /api/comments/:id */
export const remove = asyncHandler(async (req, res) => {
  await commentsService.remove(req.user, req.params.id);
  return sendNoContent(res);
});
