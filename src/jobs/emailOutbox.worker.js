/**
 * Drains the transactional email outbox (context doc §39; IMPLEMENTATION_PLAN.md
 * §0.4, Phase 9). One call = one batch: claim, send, resolve. The claim step
 * (notifications.repository.js#claimBatch) is what makes concurrent workers
 * and crash recovery both safe — see its docstring for the mechanics.
 *
 * Exported separately from src/worker.js (the process entrypoint) so tests
 * can call `drainOutbox()` directly against the real database without
 * spinning up a whole polling process.
 */
import logger from "../config/logger.js";
import env from "../config/env.js";
import { sendMail } from "../services/email/index.js";
import { notificationEmail } from "../services/email/templates/notificationEmail.js";
import * as repo from "../modules/notifications/notifications.repository.js";

export async function drainOutbox({
  batchSize = env.EMAIL_OUTBOX_BATCH_SIZE,
  maxAttempts = env.EMAIL_OUTBOX_MAX_ATTEMPTS,
} = {}) {
  const claimed = await repo.claimBatch(batchSize, maxAttempts);
  if (claimed.length === 0) {
    return { claimed: 0, sent: 0, retrying: 0, failed: 0 };
  }

  const notifications = await repo.findNotificationsByIds(claimed.map((row) => row.notificationId));
  const notificationById = new Map(notifications.map((n) => [n.id, n]));

  let sent = 0;
  let retrying = 0;
  let failed = 0;

  for (const row of claimed) {
    const notification = notificationById.get(row.notificationId);
    if (!notification) {
      // Cascade delete means this shouldn't happen, but a row with nothing
      // to send is not retryable — there's no content that will ever appear.
      await repo.markFailed(row.id, "Parent notification not found");
      failed += 1;
      continue;
    }

    try {
      const { subject, text, html } = notificationEmail({
        userId: notification.userId,
        title: notification.title,
        message: notification.message,
      });
      const result = await sendMail({ to: row.recipientEmail, subject, text, html });
      await repo.markSent(row.id, result.messageId);
      sent += 1;
    } catch (error) {
      logger.warn(
        { err: error.message, emailNotificationId: row.id, attempts: row.attempts },
        "email send failed",
      );
      if (row.attempts >= maxAttempts) {
        await repo.markFailed(row.id, error.message);
        failed += 1;
      } else {
        await repo.recordRetryableFailure(row.id, error.message);
        retrying += 1;
      }
    }
  }

  return { claimed: claimed.length, sent, retrying, failed };
}
