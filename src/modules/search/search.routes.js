import { Router } from "express";
import validate from "../../middleware/validate.middleware.js";
import * as searchController from "./search.controller.js";
import { searchQuerySchema } from "./search.validation.js";

const router = Router();

router.get("/", validate(searchQuerySchema), searchController.search);

export default router;
