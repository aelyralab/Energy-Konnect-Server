import { Router } from "express";
import validate from "../../middleware/validate.middleware.js";
import * as archiveController from "./archive.controller.js";
import { listQuerySchema, slugParamSchema } from "./archive.validation.js";

const router = Router();

router.get("/", validate(listQuerySchema), archiveController.list);
router.get("/:slug", validate(slugParamSchema), archiveController.getBySlug);

export default router;
