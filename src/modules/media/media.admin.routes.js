import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as mediaController from "./media.controller.js";
import { paginationQuery } from "../../utils/pagination.js";
import { deleteManySchema } from "./media.validation.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));
router.get("/", validate({ query: paginationQuery }), mediaController.list);
// A route, not DELETE /:id + a bulk variant — one path for both the
// individual delete button and the multi-select bar (see media.validation.js).
router.post("/delete", validate(deleteManySchema), mediaController.deleteMany);

export default router;
