import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendPaginated } from "../../utils/respond.js";
import { serializeUser } from "../../utils/serializers/user.serializer.js";
import * as usersService from "./users.service.js";

/** GET /api/admin/users */
export const list = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await usersService.listForAdmin(req.query);
  return sendPaginated(res, items.map(serializeUser), { page, limit, total });
});

/** PATCH /api/admin/users/:id */
export const update = asyncHandler(async (req, res) => {
  const user = await usersService.adminUpdate(req.user.id, req.params.id, req.body);
  return sendData(res, serializeUser(user));
});
