/**
 * API router. Every route in the application is mounted from here, so this file
 * doubles as the index of what the server exposes.
 *
 * Modules land here as their phase completes:
 *   Phase 3  /auth  /me
 *   Phase 4  /articles  /categories  /topics  /tags  /magazines
 *   Phase 5  /media
 *   Phase 6  /publisher
 *   Phase 7  /admin  /admin/magazines  /admin/users  /admin/media
 *   Phase 8  /comments
 *   Phase 9  /me/notifications  /notifications
 *   Phase 10 /search
 */
import { Router } from "express";
import healthRoutes from "../modules/health/health.routes.js";
import authRoutes from "../modules/auth/auth.routes.js";
import usersRoutes from "../modules/users/users.routes.js";
import usersAdminRoutes from "../modules/users/users.admin.routes.js";
import articlesRoutes from "../modules/articles/articles.routes.js";
import categoriesRoutes from "../modules/categories/categories.routes.js";
import categoriesAdminRoutes from "../modules/categories/categories.admin.routes.js";
import topicsRoutes from "../modules/topics/topics.routes.js";
import topicsAdminRoutes from "../modules/topics/topics.admin.routes.js";
import tagsRoutes from "../modules/tags/tags.routes.js";
import tagsAdminRoutes from "../modules/tags/tags.admin.routes.js";
import archiveRoutes from "../modules/archive/archive.routes.js";
import mediaRoutes from "../modules/media/media.routes.js";
import mediaAdminRoutes from "../modules/media/media.admin.routes.js";
import publisherRoutes from "../modules/publisher/publisher.routes.js";
import {
  reviewsRouter as adminReviewsRoutes,
  articlesRouter as adminArticlesRoutes,
} from "../modules/admin/admin.routes.js";
import magazinesAdminRoutes from "../modules/magazines/magazines.routes.js";
import commentsRoutes from "../modules/comments/comments.routes.js";
import {
  meRouter as notificationsMeRoutes,
  publicRouter as notificationsPublicRoutes,
} from "../modules/notifications/notifications.routes.js";
import searchRoutes from "../modules/search/search.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/me", usersRoutes);
router.use("/me/notifications", notificationsMeRoutes);
router.use("/notifications", notificationsPublicRoutes);
router.use("/media", mediaRoutes);
router.use("/comments", commentsRoutes);
router.use("/search", searchRoutes);

router.use("/articles", articlesRoutes);
router.use("/categories", categoriesRoutes);
router.use("/topics", topicsRoutes);
router.use("/tags", tagsRoutes);
router.use("/magazines", archiveRoutes);

router.use("/publisher", publisherRoutes);

router.use("/admin/categories", categoriesAdminRoutes);
router.use("/admin/topics", topicsAdminRoutes);
router.use("/admin/tags", tagsAdminRoutes);
router.use("/admin/reviews", adminReviewsRoutes);
router.use("/admin/articles", adminArticlesRoutes);
router.use("/admin/magazines", magazinesAdminRoutes);
router.use("/admin/users", usersAdminRoutes);
router.use("/admin/media", mediaAdminRoutes);

export default router;
