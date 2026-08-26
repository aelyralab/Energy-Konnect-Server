import { Router } from "express";
import * as healthController from "./health.controller.js";

const router = Router();

router.get("/", healthController.getHealth);
router.get("/live", healthController.getLiveness);

export default router;
