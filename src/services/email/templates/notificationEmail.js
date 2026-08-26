/**
 * Shared template for every notification type (context doc §39–41) — one
 * function, not four near-identical ones, since the only thing that differs
 * between ARTICLE_PUBLISHED/ARTICLE_APPROVED/ARTICLE_REJECTED/ISSUE_PUBLISHED
 * is the title/message text already decided by notifications.service.js.
 *
 * Carries the unsubscribe link "Resend wired in with an unsubscribe link"
 * calls for — a one-click link, no login required (utils/unsubscribeToken.js).
 */
import env from "../../../config/env.js";
import { generateUnsubscribeToken } from "../../../utils/unsubscribeToken.js";

export function notificationEmail({ userId, title, message }) {
  const unsubscribeUrl = `${env.API_BASE_URL}/api/notifications/unsubscribe?token=${generateUnsubscribeToken(userId)}`;

  const text = [
    title,
    "",
    message,
    "",
    `To stop receiving publication emails, unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #0f172a;">${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <p style="margin-top: 32px; font-size: 12px; color: #64748b;">
        <a href="${unsubscribeUrl}" style="color: #64748b;">Unsubscribe</a> from publication emails.
      </p>
    </div>
  `.trim();

  return { subject: title, text, html };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default notificationEmail;
