import asyncHandler from "../../utils/asyncHandler.js";
import { sendPaginated, sendData } from "../../utils/respond.js";
import {
  serializeIssueSummary,
  serializeIssueDetail,
} from "../../utils/serializers/issue.serializer.js";
import * as publicationsService from "./publications.service.js";

/** GET /api/publications */
export const list = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await publicationsService.listPublished(req.query);
  return sendPaginated(res, items.map(serializeIssueSummary), { page, limit, total });
});

/** GET /api/publications/:slug */
export const getBySlug = asyncHandler(async (req, res) => {
  const issue = await publicationsService.getPublishedBySlug(req.params.slug);
  return sendData(res, serializeIssueDetail(issue));
});
