import { Router } from "express";
import * as topicsController from "./topics.controller.js";

const router = Router();

router.get("/", topicsController.listPublic);

export default router;
