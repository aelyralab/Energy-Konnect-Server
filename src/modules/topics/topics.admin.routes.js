import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as topicsController from "./topics.controller.js";
import { adminListSchema, createSchema, updateSchema, idParamSchema } from "./topics.validation.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", validate(adminListSchema), topicsController.listAdmin);
router.post("/", validate(createSchema), topicsController.create);
router.patch("/:id", validate(updateSchema), topicsController.update);
router.delete("/:id", validate(idParamSchema), topicsController.remove);

export default router;
