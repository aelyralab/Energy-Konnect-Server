/**
 * Development email delivery via Gmail SMTP (nodemailer).
 *
 * Gmail, not Resend, in development — per team preference: real inbox
 * delivery while iterating locally, Resend reserved for production sending.
 * Requires a Google Account **App Password** (Google Account → Security →
 * 2-Step Verification → App passwords); Gmail rejects SMTP auth with a
 * regular account password once 2-Step Verification is on, and free Gmail
 * accounts cap outbound mail at roughly 500/day — both are why production
 * uses Resend instead (see env.js's cross-field production check).
 */
import nodemailer from "nodemailer";
import env from "../../config/env.js";
import logger from "../../config/logger.js";

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, html, text }) {
  const info = await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
  logger.info({ to, subject, messageId: info.messageId }, "[email:smtp] sent");
  return { provider: "smtp", messageId: info.messageId };
}

export default { sendMail };
