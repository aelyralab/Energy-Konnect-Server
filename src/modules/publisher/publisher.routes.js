import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as publisherController from "./publisher.controller.js";
import {
  listQuerySchema,
  createArticleSchema,
  updateArticleSchema,
  idParamSchema,
} from "./publisher.validation.js";

const router = Router();

// Every route below requires an authenticated PUBLISHER — ownership of the
// specific article is then checked per-request in the service layer, since
// "is this publisher's article" can't be known until the article is loaded.
router.use(requireAuth, requireRole("PUBLISHER"));

router.get("/articles", validate(listQuerySchema), publisherController.list);
router.post("/articles", validate(createArticleSchema), publisherController.create);
router.get("/articles/:id", validate(idParamSchema), publisherController.getOne);
router.put("/articles/:id", validate(updateArticleSchema), publisherController.update);
router.post("/articles/:id/submit", validate(idParamSchema), publisherController.submit);
router.post("/articles/:id/withdraw", validate(idParamSchema), publisherController.withdraw);
router.post("/articles/:id/revise", validate(idParamSchema), publisherController.revise);
router.delete("/articles/:id", validate(idParamSchema), publisherController.remove);
router.get("/articles/:id/history", validate(idParamSchema), publisherController.getHistory);

export default router;
