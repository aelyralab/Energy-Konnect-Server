/**
 * One-click unsubscribe links (context doc §39, "Resend wired in with an
 * unsubscribe link") have to work from inside an email client with no
 * session — an HMAC of the user id, keyed by a server secret, is enough to
 * prove "this link really was issued by us for this user" without a
 * database round trip or a login. No expiry: unsubscribe links are expected
 * to work indefinitely, same as everyone else's.
 */
import crypto from "node:crypto";
import env from "../config/env.js";

export function generateUnsubscribeToken(userId) {
  const signature = crypto.createHmac("sha256", env.COOKIE_SECRET).update(userId).digest("hex");
  return `${userId}.${signature}`;
}

// SHA-256 hex digest is always exactly 64 lowercase hex characters.
const HEX_SIGNATURE = /^[0-9a-f]{64}$/;

/** @returns {string|null} the userId if valid, else null */
export function verifyUnsubscribeToken(token) {
  if (typeof token !== "string") return null;
  const separatorIndex = token.indexOf(".");
  if (separatorIndex === -1) return null;

  const userId = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  if (!userId) return null;
  // Reject anything that isn't exactly a 64-char hex string up front —
  // `Buffer.from(str, "hex")` silently stops at the first non-hex
  // character instead of throwing, so `"<validsig>garbage"` would
  // otherwise parse down to the same 32 bytes as the real signature and
  // pass the comparison below. Tampering has to actually be caught here,
  // not left to the byte comparison to notice.
  if (!HEX_SIGNATURE.test(signature)) return null;

  const expected = crypto.createHmac("sha256", env.COOKIE_SECRET).update(userId).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const givenBuffer = Buffer.from(signature, "hex");
  if (!crypto.timingSafeEqual(expectedBuffer, givenBuffer)) return null;

  return userId;
}
