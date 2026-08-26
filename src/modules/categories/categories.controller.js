import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendCreated, sendPaginated, sendNoContent } from "../../utils/respond.js";
import { serializeTaxonomyTerm } from "../../utils/serializers/taxonomy.serializer.js";
import * as categoriesService from "./categories.service.js";

/** GET /api/categories */
export const listPublic = asyncHandler(async (_req, res) => {
  const categories = await categoriesService.listPublic();
  return sendData(res, categories.map(serializeTaxonomyTerm));
});

/** GET /api/admin/categories */
export const listAdmin = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await categoriesService.listAdmin(req.query);
  return sendPaginated(res, items.map(serializeTaxonomyTerm), { page, limit, total });
});

/** POST /api/admin/categories */
export const create = asyncHandler(async (req, res) => {
  const category = await categoriesService.create(req.body);
  return sendCreated(res, serializeTaxonomyTerm(category));
});

/** PATCH /api/admin/categories/:id */
export const update = asyncHandler(async (req, res) => {
  const category = await categoriesService.update(req.params.id, req.body);
  return sendData(res, serializeTaxonomyTerm(category));
});

/** DELETE /api/admin/categories/:id */
export const remove = asyncHandler(async (req, res) => {
  await categoriesService.remove(req.params.id);
  return sendNoContent(res);
});
