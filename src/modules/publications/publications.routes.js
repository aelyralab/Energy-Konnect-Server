import { Router } from "express";
import validate from "../../middleware/validate.middleware.js";
import * as publicationsController from "./publications.controller.js";
import { listQuerySchema, slugParamSchema } from "./publications.validation.js";

const router = Router();

router.get("/", validate(listQuerySchema), publicationsController.list);
router.get("/:slug", validate(slugParamSchema), publicationsController.getBySlug);

export default router;
