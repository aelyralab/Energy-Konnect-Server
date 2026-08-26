/**
 * Production email delivery via the Resend HTTP API.
 *
 * Called directly with `fetch` rather than the `resend` npm package — the API
 * is one POST endpoint, and skipping the SDK is one less dependency to track.
 */
import ApiError from "../../utils/ApiError.js";
import env from "../../config/env.js";
import logger from "../../config/logger.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendMail({ to, subject, html, text }) {
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html, text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error({ status: response.status, body }, "[email:resend] send failed");
    // A failed send must not look like a 4xx client mistake to the caller —
    // it is Resend/network unavailability, which is a 502 from us.
    throw new ApiError(502, "EMAIL_DELIVERY_FAILED", "Failed to send email");
  }

  const data = await response.json();
  logger.info({ to, subject, messageId: data.id }, "[email:resend] sent");
  return { provider: "resend", messageId: data.id };
}

export default { sendMail };
