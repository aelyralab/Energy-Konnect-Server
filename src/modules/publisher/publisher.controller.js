import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendCreated, sendPaginated, sendNoContent } from "../../utils/respond.js";
import {
  serializeOwnerArticleSummary,
  serializeOwnerArticleDetail,
} from "../../utils/serializers/articleOwner.serializer.js";
import { serializeReviewAction } from "../../utils/serializers/reviewAction.serializer.js";
import * as publisherService from "./publisher.service.js";

/** GET /api/publisher/articles */
export const list = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await publisherService.listOwn(req.user.id, req.query);
  return sendPaginated(res, items.map(serializeOwnerArticleSummary), { page, limit, total });
});

/** GET /api/publisher/articles/:id */
export const getOne = asyncHandler(async (req, res) => {
  const article = await publisherService.getOwn(req.user.id, req.params.id);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/publisher/articles */
export const create = asyncHandler(async (req, res) => {
  const article = await publisherService.createDraft(req.user.id, req.body);
  return sendCreated(res, serializeOwnerArticleDetail(article));
});

/** PUT /api/publisher/articles/:id */
export const update = asyncHandler(async (req, res) => {
  const article = await publisherService.updateDraft(req.user.id, req.params.id, req.body);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/publisher/articles/:id/submit */
export const submit = asyncHandler(async (req, res) => {
  const article = await publisherService.submit(req.user.id, req.params.id);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/publisher/articles/:id/withdraw */
export const withdraw = asyncHandler(async (req, res) => {
  const article = await publisherService.withdraw(req.user.id, req.params.id);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** POST /api/publisher/articles/:id/revise */
export const revise = asyncHandler(async (req, res) => {
  const article = await publisherService.revise(req.user.id, req.params.id);
  return sendData(res, serializeOwnerArticleDetail(article));
});

/** DELETE /api/publisher/articles/:id */
export const remove = asyncHandler(async (req, res) => {
  await publisherService.removeDraft(req.user.id, req.params.id);
  return sendNoContent(res);
});

/** GET /api/publisher/articles/:id/history */
export const getHistory = asyncHandler(async (req, res) => {
  const actions = await publisherService.history(req.user.id, req.params.id);
  return sendData(res, actions.map(serializeReviewAction));
});
