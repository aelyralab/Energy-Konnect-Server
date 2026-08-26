/**
 * Development fallback: logs the email instead of sending it. Zero setup —
 * this is the default so a fresh checkout works before anyone touches SMTP or
 * Resend credentials.
 */
import logger from "../../config/logger.js";

export async function sendMail({ to, subject, text }) {
  logger.info({ to, subject }, `[email:console] ${subject}`);
  // The OTP/reset code itself only ever exists in `text` — the html is a
  // formatted duplicate — so printing text is enough to unblock local testing.
  console.log(`\n--- email to ${to} ---\n${subject}\n\n${text}\n---\n`);
  return { provider: "console", messageId: null };
}

export default { sendMail };
