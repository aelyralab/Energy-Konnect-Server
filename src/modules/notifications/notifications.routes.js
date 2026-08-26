import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as notificationsController from "./notifications.controller.js";
import {
  listQuerySchema,
  idParamSchema,
  unsubscribeQuerySchema,
} from "./notifications.validation.js";

/** Mounted at /api/me/notifications. */
const meRouter = Router();
meRouter.use(requireAuth);
meRouter.get("/", validate(listQuerySchema), notificationsController.list);
meRouter.patch("/:id/read", validate(idParamSchema), notificationsController.markRead);

/** Mounted at /api/notifications — public. The unsubscribe link in an email
 * has no session to authenticate with; its own signed token is the auth. */
const publicRouter = Router();
publicRouter.get(
  "/unsubscribe",
  validate(unsubscribeQuerySchema),
  notificationsController.unsubscribe,
);

export { meRouter, publicRouter };
