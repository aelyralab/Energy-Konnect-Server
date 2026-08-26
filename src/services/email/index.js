/**
 * Email provider facade. Every caller imports from here — never from a
 * specific provider file — so swapping providers is a one-line env change,
 * not a code change (IMPLEMENTATION_PLAN.md §0.1: "providers behind adapter
 * interfaces").
 */
import env from "../../config/env.js";
import consoleProvider from "./console.provider.js";
import smtpProvider from "./smtp.provider.js";
import resendProvider from "./resend.provider.js";

const PROVIDERS = {
  console: consoleProvider,
  smtp: smtpProvider,
  resend: resendProvider,
};

const activeProvider = PROVIDERS[env.EMAIL_PROVIDER];

/** @param {{to: string, subject: string, html: string, text: string}} message */
export async function sendMail(message) {
  return activeProvider.sendMail(message);
}

export default { sendMail };
