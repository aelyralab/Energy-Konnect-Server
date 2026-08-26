import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendNoContent } from "../../utils/respond.js";
import { serializeUser } from "../../utils/serializers/user.serializer.js";
import * as usersService from "./users.service.js";

/** GET /api/me */
export const getMe = asyncHandler(async (req, res) => {
  return sendData(res, { user: serializeUser(req.user) });
});

/** PATCH /api/me */
export const updateMe = asyncHandler(async (req, res) => {
  const user = await usersService.updateProfile(req.user.id, req.body);
  return sendData(res, { user: serializeUser(user) });
});

/** PATCH /api/me/password */
export const changePassword = asyncHandler(async (req, res) => {
  await usersService.changePassword(req.user.id, req.body);
  return sendNoContent(res);
});
