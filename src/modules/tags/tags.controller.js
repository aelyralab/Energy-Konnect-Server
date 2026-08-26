import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendCreated, sendPaginated, sendNoContent } from "../../utils/respond.js";
import { serializeTag } from "../../utils/serializers/taxonomy.serializer.js";
import * as tagsService from "./tags.service.js";

/** GET /api/tags */
export const listPublic = asyncHandler(async (_req, res) => {
  const tags = await tagsService.listPublic();
  return sendData(res, tags.map(serializeTag));
});

/** GET /api/admin/tags */
export const listAdmin = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await tagsService.listAdmin(req.query);
  return sendPaginated(res, items.map(serializeTag), { page, limit, total });
});

/** POST /api/admin/tags */
export const create = asyncHandler(async (req, res) => {
  const tag = await tagsService.create(req.body);
  return sendCreated(res, serializeTag(tag));
});

/** PATCH /api/admin/tags/:id */
export const update = asyncHandler(async (req, res) => {
  const tag = await tagsService.update(req.params.id, req.body);
  return sendData(res, serializeTag(tag));
});

/** DELETE /api/admin/tags/:id */
export const remove = asyncHandler(async (req, res) => {
  await tagsService.remove(req.params.id);
  return sendNoContent(res);
});
