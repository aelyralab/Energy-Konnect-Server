import asyncHandler from "../../utils/asyncHandler.js";
import { sendPaginated, sendData } from "../../utils/respond.js";
import {
  serializeArticleSummary,
  serializeArticleDetail,
} from "../../utils/serializers/article.serializer.js";
import * as articlesService from "./articles.service.js";

/** GET /api/articles */
export const list = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await articlesService.listPublished(req.query);
  return sendPaginated(res, items.map(serializeArticleSummary), { page, limit, total });
});

/** GET /api/articles/:slug */
export const getBySlug = asyncHandler(async (req, res) => {
  const article = await articlesService.getPublishedBySlug(req.params.slug);
  return sendData(res, serializeArticleDetail(article));
});
