import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

// --- Recipient lookups -------------------------------------------------

/** Broadcast recipients (§41): active accounts opted into publication email.
 * `excludeUserId` is null for issue notifications (no single article owner
 * to exclude) and set for article notifications (skip the article's own
 * publisher — they get a more specific ARTICLE_APPROVED notification instead). */
export function findBroadcastRecipients(excludeUserId, db = prisma) {
  return db.user.findMany({
    where: {
      isActive: true,
      emailNotifications: true,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true, email: true },
  });
}

/** The single-recipient case (approve/reject) — deliberately not filtered by
 * emailNotifications: telling a publisher the outcome of their own
 * submission is transactional, not a "new publication" broadcast (§41
 * distinguishes the two), so it always sends as long as the account is active. */
export async function findSingleRecipient(userId, db = prisma) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isActive: true },
  });
  return user && user.isActive ? user : null;
}

// --- Outbox writes (called inside the caller's transaction) ------------

/**
 * One Notification row per recipient (each is a distinct user's in-app
 * notification) plus one linked EmailNotification row at PENDING each —
 * the fan-out itself happens here, in Postgres, in a single round trip per
 * table via `createManyAndReturn` — Redis never sees per-recipient work
 * (IMPLEMENTATION_PLAN.md §0.4).
 */
export async function createBatch({ recipients, type, articleId, title, message }, db = prisma) {
  if (recipients.length === 0) return [];

  const notifications = await db.notification.createManyAndReturn({
    data: recipients.map((recipient) => ({
      userId: recipient.id,
      type,
      articleId,
      title,
      message,
    })),
  });

  // Paired by userId, not array index — createManyAndReturn doesn't
  // guarantee it preserves input order.
  const emailByUserId = new Map(recipients.map((recipient) => [recipient.id, recipient.email]));
  await db.emailNotification.createMany({
    data: notifications.map((notification) => ({
      notificationId: notification.id,
      recipientEmail: emailByUserId.get(notification.userId),
      status: "PENDING",
    })),
  });

  return notifications;
}

// --- Worker: claim, send, resolve ---------------------------------------

/**
 * Atomically claims up to `batchSize` PENDING rows and increments their
 * `attempts` in one statement — the `FOR UPDATE SKIP LOCKED` CTE means a
 * second worker running the same query concurrently skips whatever this one
 * already has locked, and the row lock is held only for this one statement,
 * not across the slow email-send call that follows. If the process crashes
 * before the send completes, the transaction implicit in this single
 * statement has already committed the `attempts` increment but nothing
 * marks the row SENT — so it stays PENDING and a later poll retries it
 * (up to `maxAttempts`, then the worker gives up and marks it FAILED).
 */
export function claimBatch(batchSize, maxAttempts, db = prisma) {
  return db.$queryRaw`
    WITH claimed AS (
      SELECT id FROM email_notifications
      WHERE status = 'PENDING' AND attempts < ${maxAttempts}
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE email_notifications
    SET attempts = attempts + 1
    WHERE id IN (SELECT id FROM claimed)
    RETURNING
      id,
      notification_id AS "notificationId",
      recipient_email AS "recipientEmail",
      attempts;
  `;
}

export function findNotificationsByIds(ids, db = prisma) {
  return db.notification.findMany({ where: { id: { in: ids } } });
}

export function markSent(id, providerMessageId, db = prisma) {
  return db.emailNotification.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date(), providerMessageId: providerMessageId ?? null },
  });
}

/** Still under the attempt cap — leave it PENDING for a later poll. */
export function recordRetryableFailure(id, error, db = prisma) {
  return db.emailNotification.update({
    where: { id },
    data: { error: String(error).slice(0, 2000) },
  });
}

/** Attempt cap reached — give up. */
export function markFailed(id, error, db = prisma) {
  return db.emailNotification.update({
    where: { id },
    data: { status: "FAILED", failedAt: new Date(), error: String(error).slice(0, 2000) },
  });
}

// --- Account-facing (GET/PATCH /api/me/notifications) -------------------

export async function findForUser({ userId, page, limit }) {
  const where = { userId };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...toSkipTake({ page, limit }),
    }),
    prisma.notification.count({ where }),
  ]);
  return { items, total };
}

export function findByIdForUser(id, userId) {
  return prisma.notification.findFirst({ where: { id, userId } });
}

export function markRead(id) {
  return prisma.notification.update({ where: { id }, data: { isRead: true } });
}

export function setEmailNotifications(userId, emailNotifications) {
  return prisma.user.update({ where: { id: userId }, data: { emailNotifications } });
}
