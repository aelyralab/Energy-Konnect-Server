import asyncHandler from "../../utils/asyncHandler.js";
import { sendCreated, sendPaginated } from "../../utils/respond.js";
import { serializeMedia } from "../../utils/serializers/media.serializer.js";
import * as mediaService from "./media.service.js";

/** POST /api/media */
export const upload = asyncHandler(async (req, res) => {
  const media = await mediaService.uploadMedia({ file: req.file, uploadedBy: req.user.id });
  return sendCreated(res, serializeMedia(media));
});

/** GET /api/admin/media */
export const list = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await mediaService.listAll(req.query);
  return sendPaginated(
    res,
    items.map((media) => ({ ...serializeMedia(media), uploader: media.uploader })),
    { page, limit, total },
  );
});
