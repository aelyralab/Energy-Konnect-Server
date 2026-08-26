/**
 * Access tokens (short-lived JWT) and refresh tokens (opaque, revocable).
 *
 * Two different mechanisms deliberately: a JWT proves itself without a
 * database round trip, which is what you want on every request, but it can't
 * be revoked before it expires — fine for a 15-minute access token, not fine
 * for a 30-day session. Refresh tokens are therefore plain random values,
 * stored as a SHA-256 hash (`refresh_tokens.token_hash`) so a stolen database
 * dump doesn't hand out live sessions, and looked up by that hash on every
 * refresh so they *can* be revoked instantly (logout, rotation, reuse
 * detection). Argon2 is used for passwords/OTP, never here — those are only
 * ever compared to one known value at input time, but a refresh token must be
 * found by its hash among many rows, which Argon2's per-hash random salt
 * makes impossible without checking every row.
 */
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import env from "../config/env.js";

/** @param {{sub: string, role: string}} payload */
export function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: "energy-konnect-api",
  });
}

/** @returns {{sub: string, role: string, iat: number, exp: number}} */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: "energy-konnect-api" });
}

/** 256 bits of randomness, URL-safe — the value that goes in the client's cookie. */
export function generateRefreshTokenValue() {
  return crypto.randomBytes(48).toString("base64url");
}

/** Deterministic, one-way — what actually gets stored and queried. */
export function hashRefreshTokenValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function refreshTokenExpiryDate() {
  const expires = new Date();
  expires.setDate(expires.getDate() + env.REFRESH_TOKEN_TTL_DAYS);
  return expires;
}
