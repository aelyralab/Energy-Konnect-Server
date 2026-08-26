import { Router } from "express";
import * as tagsController from "./tags.controller.js";

const router = Router();

router.get("/", tagsController.listPublic);

export default router;
