/**
 * Only POST and DELETE live here — GET /api/articles/:slug/comments is
 * mounted from the articles module (see articles.routes.js) since that's
 * where it sits in the URL hierarchy, even though it's this module's
 * controller/service doing the work.
 */
import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as commentsController from "./comments.controller.js";
import { createCommentSchema, idParamSchema } from "./comments.validation.js";

const router = Router();

router.use(requireAuth);

router.post("/", validate(createCommentSchema), commentsController.create);
router.delete("/:id", validate(idParamSchema), commentsController.remove);

export default router;
