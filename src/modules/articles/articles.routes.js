import { Router } from "express";
import validate from "../../middleware/validate.middleware.js";
import { optionalAuth } from "../../middleware/auth.middleware.js";
import guestLimit from "../../middleware/guestLimit.middleware.js";
import * as articlesController from "./articles.controller.js";
import * as commentsController from "../comments/comments.controller.js";
import { listQuerySchema, slugParamSchema } from "./articles.validation.js";
import { listByArticleQuerySchema } from "../comments/comments.validation.js";

const router = Router();

router.get("/", validate(listQuerySchema), articlesController.list);
// optionalAuth first: guestLimit needs to know whether req.user is set
// before deciding whether the guest-read bookkeeping even applies.
router.get(
  "/:slug",
  validate(slugParamSchema),
  optionalAuth,
  guestLimit,
  articlesController.getBySlug,
);
router.get(
  "/:slug/comments",
  validate(listByArticleQuerySchema),
  commentsController.listForArticle,
);

export default router;
