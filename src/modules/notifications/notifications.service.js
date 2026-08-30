/**
 * Notification creation (context doc §39–41). Called from inside the
 * transactions that change article/magazine state (admin.service.js,
 * magazines.service.js), passing their `tx` through so the notification rows
 * commit atomically with the state change they describe — approving an
 * article and failing to notify anyone about it (or vice versa) would both
 * be silent bugs.
 *
 * Delivery itself — actually sending the emails — is the outbox worker's
 * job (jobs/emailOutbox.worker.js). This file only ever writes PENDING rows.
 */
import ApiError from "../../utils/ApiError.js";
import * as repo from "./notifications.repository.js";
import { verifyUnsubscribeToken } from "../../utils/unsubscribeToken.js";

export async function notifyArticlePublished(article, db) {
  const recipients = await repo.findBroadcastRecipients(article.publisherId, db);
  await repo.createBatch(
    {
      recipients,
      type: "ARTICLE_PUBLISHED",
      articleId: article.id,
      title: "New article published",
      message: `"${article.title}" has just been published on Energy Konnect.`,
    },
    db,
  );
}

/** Covers both "a submission was approved" and "admin published your draft
 * directly" — the publisher cares about the same thing either way: their
 * article just went live. Not gated by emailNotifications (§41 — this is
 * about the publisher's own submission, not a general broadcast). */
export async function notifyArticleApproved(article, db) {
  const recipient = await repo.findSingleRecipient(article.publisherId, db);
  if (!recipient) return;
  await repo.createBatch(
    {
      recipients: [recipient],
      type: "ARTICLE_APPROVED",
      articleId: article.id,
      title: "Your article was approved",
      message: `"${article.title}" has been approved and is now published.`,
    },
    db,
  );
}

export async function notifyArticleRejected(article, reason, db) {
  const recipient = await repo.findSingleRecipient(article.publisherId, db);
  if (!recipient) return;
  await repo.createBatch(
    {
      recipients: [recipient],
      type: "ARTICLE_REJECTED",
      articleId: article.id,
      title: "Your article was not approved",
      message: `"${article.title}" was rejected. Reason: ${reason}`,
    },
    db,
  );
}

export async function notifyMagazinePublished(magazine, db) {
  const recipients = await repo.findBroadcastRecipients(null, db);
  await repo.createBatch(
    {
      recipients,
      type: "MAGAZINE_PUBLISHED",
      // Notification.articleId has no magazine-side equivalent column — the
      // magazine's identity lives in the message text instead of a relation.
      articleId: null,
      title: "New magazine published",
      message: `"${magazine.title}" (Volume ${magazine.volumeNumber}, Issue ${magazine.issueNumber}) is now available.`,
    },
    db,
  );
}

// --- Account-facing ---------------------------------------------------

export async function listForUser(userId, query) {
  const { items, total } = await repo.findForUser({ userId, ...query });
  return { items, total, page: query.page, limit: query.limit };
}

export async function markRead(userId, id) {
  const notification = await repo.findByIdForUser(id, userId);
  if (!notification) throw ApiError.notFound("Notification not found");
  return repo.markRead(id);
}

export async function unsubscribe(token) {
  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    throw ApiError.badRequest("Invalid or expired unsubscribe link", undefined, "INVALID_TOKEN");
  }
  // No separate existence check — Prisma's update-by-id throws P2025 for a
  // nonexistent userId, which the error middleware already maps to 404.
  await repo.setEmailNotifications(userId, false);
}
