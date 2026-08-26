/**
 * ArticleReviewAction — the editorial audit trail (context doc §25). Written
 * by both the publisher workflow (SUBMITTED, WITHDRAWN — Phase 6) and the
 * admin workflow (APPROVED, REJECTED, PUBLISHED_DIRECT, UNPUBLISHED,
 * ARCHIVED — Phase 7), which is why this is its own small module rather than
 * living inside either one.
 */
import prisma from "../../config/db.js";

export function create({ articleId, articleVersionId, actorId, action, reason }, db = prisma) {
  return db.articleReviewAction.create({
    data: { articleId, articleVersionId, actorId, action, reason },
  });
}

export function findByArticleId(articleId, db = prisma) {
  return db.articleReviewAction.findMany({
    where: { articleId },
    orderBy: { createdAt: "desc" },
    include: {
      actor: { select: { id: true, name: true, role: true } },
      version: { select: { versionNumber: true } },
    },
  });
}
