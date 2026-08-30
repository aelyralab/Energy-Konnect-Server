import asyncHandler from "../../utils/asyncHandler.js";
import { sendPaginated, sendData } from "../../utils/respond.js";
import {
  serializeMagazineSummary,
  serializeMagazineDetail,
} from "../../utils/serializers/magazine.serializer.js";
import * as archiveService from "./archive.service.js";

/** GET /api/magazines */
export const list = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await archiveService.listPublished(req.query);
  return sendPaginated(res, items.map(serializeMagazineSummary), { page, limit, total });
});

/** GET /api/magazines/:slug */
export const getBySlug = asyncHandler(async (req, res) => {
  const magazine = await archiveService.getPublishedBySlug(req.params.slug);
  return sendData(res, serializeMagazineDetail(magazine));
});
