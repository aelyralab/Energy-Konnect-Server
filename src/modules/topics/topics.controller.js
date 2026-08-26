import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendCreated, sendPaginated, sendNoContent } from "../../utils/respond.js";
import { serializeTaxonomyTerm } from "../../utils/serializers/taxonomy.serializer.js";
import * as topicsService from "./topics.service.js";

/** GET /api/topics */
export const listPublic = asyncHandler(async (_req, res) => {
  const topics = await topicsService.listPublic();
  return sendData(res, topics.map(serializeTaxonomyTerm));
});

/** GET /api/admin/topics */
export const listAdmin = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await topicsService.listAdmin(req.query);
  return sendPaginated(res, items.map(serializeTaxonomyTerm), { page, limit, total });
});

/** POST /api/admin/topics */
export const create = asyncHandler(async (req, res) => {
  const topic = await topicsService.create(req.body);
  return sendCreated(res, serializeTaxonomyTerm(topic));
});

/** PATCH /api/admin/topics/:id */
export const update = asyncHandler(async (req, res) => {
  const topic = await topicsService.update(req.params.id, req.body);
  return sendData(res, serializeTaxonomyTerm(topic));
});

/** DELETE /api/admin/topics/:id */
export const remove = asyncHandler(async (req, res) => {
  await topicsService.remove(req.params.id);
  return sendNoContent(res);
});
