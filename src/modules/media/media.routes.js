/**
 * Shared by both roles: upload validation, storage, and metadata are
 * identical for a PUBLISHER and an ADMIN — the doc's §36 API surface lists
 * this under both /api/publisher/media and /api/admin/media only because of
 * REST namespacing, not because the operation differs. One route, gated to
 * either role, avoids maintaining two copies of the same handler.
 */
import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import uploadSingle from "../../middleware/upload.middleware.js";
import * as mediaController from "./media.controller.js";

const router = Router();

router.use(requireAuth, requireRole("PUBLISHER", "ADMIN"));
router.post("/", uploadSingle("file"), mediaController.upload);

export default router;
