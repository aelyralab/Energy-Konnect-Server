import { Router } from "express";
import * as categoriesController from "./categories.controller.js";

const router = Router();

router.get("/", categoriesController.listPublic);

export default router;
