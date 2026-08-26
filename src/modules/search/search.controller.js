import asyncHandler from "../../utils/asyncHandler.js";
import { sendPaginated } from "../../utils/respond.js";
import { serializeArticleSummary } from "../../utils/serializers/article.serializer.js";
import * as searchService from "./search.service.js";

/** GET /api/search?q=...&page&limit&category&topic&tag */
export const search = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await searchService.search(req.query);
  return sendPaginated(
    res,
    items.map((item) => ({ ...serializeArticleSummary(item), snippet: item.snippet })),
    { page, limit, total },
  );
});
