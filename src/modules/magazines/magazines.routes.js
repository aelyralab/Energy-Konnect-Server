import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as magazinesController from "./magazines.controller.js";
import {
  listQuerySchema,
  idParamSchema,
  createMagazineSchema,
  updateMagazineSchema,
  attachArticleSchema,
  reorderSchema,
  detachArticleSchema,
} from "./magazines.validation.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", validate(listQuerySchema), magazinesController.list);
router.post("/", validate(createMagazineSchema), magazinesController.create);
router.get("/:id", validate(idParamSchema), magazinesController.getOne);
router.put("/:id", validate(updateMagazineSchema), magazinesController.update);
router.delete("/:id", validate(idParamSchema), magazinesController.remove);

router.post("/:id/articles", validate(attachArticleSchema), magazinesController.attachArticle);
router.patch("/:id/articles/reorder", validate(reorderSchema), magazinesController.reorderArticles);
router.delete(
  "/:id/articles/:articleId",
  validate(detachArticleSchema),
  magazinesController.detachArticle,
);

router.post("/:id/publish", validate(idParamSchema), magazinesController.publish);
router.post("/:id/archive", validate(idParamSchema), magazinesController.archive);

export default router;
