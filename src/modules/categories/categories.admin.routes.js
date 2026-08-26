import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as categoriesController from "./categories.controller.js";
import {
  adminListSchema,
  createSchema,
  updateSchema,
  idParamSchema,
} from "./categories.validation.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", validate(adminListSchema), categoriesController.listAdmin);
router.post("/", validate(createSchema), categoriesController.create);
router.patch("/:id", validate(updateSchema), categoriesController.update);
router.delete("/:id", validate(idParamSchema), categoriesController.remove);

export default router;
