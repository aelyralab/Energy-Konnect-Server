/**
 * Comments (context doc §23–24). Single-level — no `parentCommentId`, no
 * reporting/flagging, per rules 20–21: adding either without the requirement
 * actually changing would be exactly the "design for hypothetical future
 * requirements" this codebase avoids.
 */
import ApiError from "../../utils/ApiError.js";
import * as repo from "./comments.repository.js";
import * as articlesService from "../articles/articles.service.js";

export async function create(userId, { articleId, content }) {
  const published = await articlesService.isPublished(articleId);
  if (!published) {
    throw ApiError.badRequest(
      "Comments can only be posted on a published article",
      { field: "articleId" },
      "ARTICLE_NOT_PUBLISHED",
    );
  }
  return repo.create({ articleId, userId, content });
}

export async function listForArticleSlug(slug, { page, limit }) {
  // getPublishedBySlug already 404s on a draft/missing slug — comments on
  // an article the public can't see would themselves be a rule-30 leak.
  const article = await articlesService.getPublishedBySlug(slug);
  const { items, total } = await repo.findByArticleId({ articleId: article.id, page, limit });
  return { items, total, page, limit };
}

/**
 * Author or admin, never anyone else. A 403 doesn't leak anything extra
 * here — unlike an unpublished article, an existing comment is already
 * publicly visible via the list endpoint, so there's nothing to hide by
 * distinguishing "not yours" from "doesn't exist".
 */
export async function remove(actor, commentId) {
  const comment = await repo.findById(commentId);
  if (!comment) throw ApiError.notFound("Comment not found");

  const isOwner = comment.userId === actor.id;
  const isAdmin = actor.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    throw ApiError.forbidden("You can only delete your own comments", "NOT_YOUR_COMMENT");
  }

  await repo.softDelete(commentId);
}
