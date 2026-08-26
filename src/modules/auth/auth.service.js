/**
 * Auth business logic. Context doc §6 lifecycle:
 *   register → create user → generate OTP → hash/store → email →
 *   user enters OTP → verify → email_verified = true
 *
 * Deliberate choices beyond the doc (see IMPLEMENTATION_PLAN.md §0.2.4):
 *   - OTP: 6 digits, OTP_TTL_MINUTES expiry, OTP_MAX_ATTEMPTS verify attempts.
 *   - Successful verification auto-issues a session (no separate login step
 *     required right after signing up).
 *   - login is refused while emailVerified is false or isActive is false.
 *   - Refresh tokens rotate on every use; presenting an already-rotated
 *     (i.e. stolen) token revokes every session the user has.
 */
import ApiError from "../../utils/ApiError.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import generateOtp from "../../utils/otp.js";
import {
  signAccessToken,
  generateRefreshTokenValue,
  hashRefreshTokenValue,
  refreshTokenExpiryDate,
} from "../../utils/jwt.js";
import env from "../../config/env.js";
import { sendMail } from "../../services/email/index.js";
import { otpEmail } from "../../services/email/templates/otpEmail.js";
import * as repo from "./auth.repository.js";

function otpExpiryDate() {
  return new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);
}

async function issueOtp(user) {
  const otp = generateOtp();
  const otpHash = await hashPassword(otp);
  await repo.createVerification({ userId: user.id, otpHash, expiresAt: otpExpiryDate() });

  const { subject, text, html } = otpEmail({
    name: user.name,
    otp,
    ttlMinutes: env.OTP_TTL_MINUTES,
  });
  await sendMail({ to: user.email, subject, text, html });
}

async function issueSession(user, { userAgent, ip } = {}) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });

  const refreshTokenValue = generateRefreshTokenValue();
  await repo.createRefreshToken({
    userId: user.id,
    tokenHash: hashRefreshTokenValue(refreshTokenValue),
    expiresAt: refreshTokenExpiryDate(),
    userAgent: userAgent?.slice(0, 400),
    ip,
  });

  return { accessToken, refreshTokenValue };
}

// --- Registration --------------------------------------------------------

export async function register({ name, email, password }) {
  const existing = await repo.findUserByEmail(email);
  if (existing) {
    throw ApiError.conflict(
      "An account with this email already exists",
      "EMAIL_ALREADY_REGISTERED",
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await repo.createUser({ name, email, passwordHash });
  await issueOtp(user);

  return user;
}

export async function resendOtp(email) {
  const user = await repo.findUserByEmail(email);
  // Deliberately silent on "no such account" / "already verified" — this
  // endpoint must not let a caller discover which emails are registered.
  if (!user || user.emailVerified) return;

  await issueOtp(user);
}

export async function verifyOtp({ email, otp }, sessionContext) {
  const genericError = () =>
    ApiError.badRequest("Invalid or expired code", { field: "otp" }, "INVALID_OTP");

  const user = await repo.findUserByEmail(email);
  if (!user) throw genericError();
  if (user.emailVerified) {
    throw ApiError.conflict("This email is already verified", "ALREADY_VERIFIED");
  }

  const verification = await repo.findActiveVerification(user.id);
  if (!verification) throw genericError();

  if (verification.expiresAt < new Date()) throw genericError();

  if (verification.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw ApiError.tooManyRequests(
      "Too many incorrect attempts — request a new code",
      undefined,
      "OTP_ATTEMPTS_EXCEEDED",
    );
  }

  const matches = await verifyPassword(otp, verification.otpHash);
  if (!matches) {
    await repo.incrementVerificationAttempts(verification.id);
    throw genericError();
  }

  await repo.consumeVerification(verification.id);
  const verifiedUser = await repo.markEmailVerified(user.id);

  const session = await issueSession(verifiedUser, sessionContext);
  return { user: verifiedUser, ...session };
}

// --- Login / session lifecycle --------------------------------------------

export async function login({ email, password }, sessionContext) {
  const invalidCredentials = () =>
    ApiError.unauthorized("Incorrect email or password", "INVALID_CREDENTIALS");

  const user = await repo.findUserByEmail(email);
  if (!user) throw invalidCredentials();

  const matches = await verifyPassword(password, user.passwordHash);
  if (!matches) throw invalidCredentials();

  if (!user.isActive) {
    throw ApiError.forbidden("This account has been deactivated", "ACCOUNT_DEACTIVATED");
  }
  if (!user.emailVerified) {
    throw ApiError.forbidden("Please verify your email before signing in", "EMAIL_NOT_VERIFIED");
  }

  const session = await issueSession(user, sessionContext);
  return { user, ...session };
}

export async function refresh(refreshTokenValue, sessionContext) {
  const invalid = () =>
    ApiError.unauthorized("Session expired — please sign in again", "INVALID_REFRESH_TOKEN");

  if (!refreshTokenValue) throw invalid();

  const tokenHash = hashRefreshTokenValue(refreshTokenValue);
  const existing = await repo.findRefreshTokenByHash(tokenHash);
  if (!existing) throw invalid();

  if (existing.revokedAt) {
    // The only legitimate way to see a revoked token is normal expiry
    // cleanup, which never re-presents it to us — so this is reuse of a
    // token that was already rotated (or explicitly logged out). Treat the
    // whole session set as compromised.
    await repo.revokeAllRefreshTokensForUser(existing.userId);
    throw ApiError.unauthorized(
      "This session was already used elsewhere and has been revoked for safety — please sign in again",
      "REFRESH_TOKEN_REUSED",
    );
  }

  if (existing.expiresAt < new Date()) throw invalid();

  const user = await repo.findUserById(existing.userId);
  if (!user || !user.isActive) {
    await repo.revokeRefreshToken(existing.id);
    throw invalid();
  }

  const session = await issueSession(user, sessionContext);
  const newTokenHash = hashRefreshTokenValue(session.refreshTokenValue);
  // Recover the id of the row we just created, purely so the old row can
  // record which token replaced it (audit trail, not load-bearing).
  const newToken = await repo.findRefreshTokenByHash(newTokenHash);
  await repo.rotateRefreshToken({ oldId: existing.id, newId: newToken.id });

  return { user, ...session };
}

export async function logout(refreshTokenValue) {
  if (!refreshTokenValue) return;
  const existing = await repo.findRefreshTokenByHash(hashRefreshTokenValue(refreshTokenValue));
  if (existing && !existing.revokedAt) {
    await repo.revokeRefreshToken(existing.id);
  }
}

// --- Profile ---------------------------------------------------------------

// Profile reads/updates (GET/PATCH /api/me, password change) belong to the
// users module, not here — this file is authentication only.
