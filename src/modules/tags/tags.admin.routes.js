import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as tagsController from "./tags.controller.js";
import { adminListSchema, createSchema, updateSchema, idParamSchema } from "./tags.validation.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", validate(adminListSchema), tagsController.listAdmin);
router.post("/", validate(createSchema), tagsController.create);
router.patch("/:id", validate(updateSchema), tagsController.update);
router.delete("/:id", validate(idParamSchema), tagsController.remove);

export default router;
