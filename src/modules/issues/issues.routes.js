import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as issuesController from "./issues.controller.js";
import {
  listQuerySchema,
  idParamSchema,
  createIssueSchema,
  updateIssueSchema,
  attachArticleSchema,
  reorderSchema,
  detachArticleSchema,
} from "./issues.validation.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", validate(listQuerySchema), issuesController.list);
router.post("/", validate(createIssueSchema), issuesController.create);
router.get("/:id", validate(idParamSchema), issuesController.getOne);
router.put("/:id", validate(updateIssueSchema), issuesController.update);
router.delete("/:id", validate(idParamSchema), issuesController.remove);

router.post("/:id/articles", validate(attachArticleSchema), issuesController.attachArticle);
router.patch("/:id/articles/reorder", validate(reorderSchema), issuesController.reorderArticles);
router.delete(
  "/:id/articles/:articleId",
  validate(detachArticleSchema),
  issuesController.detachArticle,
);

router.post("/:id/publish", validate(idParamSchema), issuesController.publish);
router.post("/:id/archive", validate(idParamSchema), issuesController.archive);

export default router;
