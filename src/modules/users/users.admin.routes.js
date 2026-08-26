import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as usersAdminController from "./users.admin.controller.js";
import { adminListQuerySchema, adminUpdateSchema } from "./users.validation.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", validate(adminListQuerySchema), usersAdminController.list);
router.patch("/:id", validate(adminUpdateSchema), usersAdminController.update);

export default router;
