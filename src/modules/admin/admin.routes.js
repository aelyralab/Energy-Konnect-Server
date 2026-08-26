import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as adminController from "./admin.controller.js";
import {
  reviewQueueQuerySchema,
  listQuerySchema,
  idParamSchema,
  versionIdParamSchema,
  createArticleSchema,
  updateArticleSchema,
  rejectSchema,
} from "./admin.validation.js";

const reviewsRouter = Router();
reviewsRouter.use(requireAuth, requireRole("ADMIN"));
reviewsRouter.get("/", validate(reviewQueueQuerySchema), adminController.listReviewQueue);

const articlesRouter = Router();
articlesRouter.use(requireAuth, requireRole("ADMIN"));

articlesRouter.get("/", validate(listQuerySchema), adminController.listArticles);
articlesRouter.post("/", validate(createArticleSchema), adminController.createArticle);
articlesRouter.get("/:id", validate(idParamSchema), adminController.getArticle);
articlesRouter.put("/:id", validate(updateArticleSchema), adminController.updateArticle);
articlesRouter.put(
  "/:id/published-content",
  validate(updateArticleSchema),
  adminController.editPublished,
);
articlesRouter.delete("/:id", validate(idParamSchema), adminController.remove);
articlesRouter.post("/:id/approve", validate(idParamSchema), adminController.approve);
articlesRouter.post("/:id/reject", validate(rejectSchema), adminController.reject);
articlesRouter.post("/:id/publish", validate(idParamSchema), adminController.publish);
articlesRouter.post("/:id/unpublish", validate(idParamSchema), adminController.unpublish);
articlesRouter.post("/:id/archive", validate(idParamSchema), adminController.archive);
articlesRouter.get("/:id/versions", validate(idParamSchema), adminController.listVersions);
articlesRouter.get(
  "/:id/versions/:versionId",
  validate(versionIdParamSchema),
  adminController.getVersion,
);
articlesRouter.get("/:id/history", validate(idParamSchema), adminController.getHistory);

export { reviewsRouter, articlesRouter };
