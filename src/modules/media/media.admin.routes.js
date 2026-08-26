import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as mediaController from "./media.controller.js";
import { paginationQuery } from "../../utils/pagination.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));
router.get("/", validate({ query: paginationQuery }), mediaController.list);

export default router;
