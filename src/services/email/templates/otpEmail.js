/**
 * Verification-code email. Plain-text-first: `text` is what the console and
 * SMTP providers surface most visibly, `html` is a light wrapper for real
 * inboxes. Kept template-free (no external engine) — one string, one place.
 */
export function otpEmail({ name, otp, ttlMinutes }) {
  const subject = "Your Energy Konnect verification code";

  const text = [
    `Hi ${name},`,
    "",
    `Your Energy Konnect verification code is: ${otp}`,
    "",
    `This code expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.`,
  ].join("\n");

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #0f172a;">Verify your email</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your Energy Konnect verification code is:</p>
      <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0f172a;">${otp}</p>
      <p>This code expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.</p>
    </div>
  `.trim();

  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default otpEmail;
