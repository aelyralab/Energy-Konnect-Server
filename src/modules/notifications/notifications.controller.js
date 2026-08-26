import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendPaginated } from "../../utils/respond.js";
import { serializeNotification } from "../../utils/serializers/notification.serializer.js";
import * as notificationsService from "./notifications.service.js";

/** GET /api/me/notifications */
export const list = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await notificationsService.listForUser(
    req.user.id,
    req.query,
  );
  return sendPaginated(res, items.map(serializeNotification), { page, limit, total });
});

/** PATCH /api/me/notifications/:id/read */
export const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationsService.markRead(req.user.id, req.params.id);
  return sendData(res, serializeNotification(notification));
});

/** GET /api/notifications/unsubscribe?token=... — public, no auth: the
 * whole point is that it works from inside an email client. */
export const unsubscribe = asyncHandler(async (req, res) => {
  await notificationsService.unsubscribe(req.query.token);
  return sendData(res, { message: "You have been unsubscribed from publication emails." });
});
