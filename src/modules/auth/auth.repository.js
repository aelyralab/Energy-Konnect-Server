/**
 * All Prisma access for auth lives here. auth.service.js never imports
 * `config/db.js` directly (IMPLEMENTATION_PLAN.md §2/§37).
 */
import prisma from "../../config/db.js";

export function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

export function findUserById(id) {
  return prisma.user.findUnique({ where: { id } });
}

export function createUser({ name, email, passwordHash }) {
  return prisma.user.create({
    data: { name, email, passwordHash, role: "USER", emailVerified: false },
  });
}

export function markEmailVerified(userId) {
  return prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
}

// --- Email verification (OTP) -----------------------------------------------

export function createVerification({ userId, otpHash, expiresAt, purpose = "EMAIL_VERIFICATION" }) {
  return prisma.userEmailVerification.create({
    data: { userId, otpHash, expiresAt, purpose },
  });
}

/** The most recent not-yet-consumed code for this user/purpose. */
export function findActiveVerification(userId, purpose = "EMAIL_VERIFICATION") {
  return prisma.userEmailVerification.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export function findLatestVerification(userId, purpose = "EMAIL_VERIFICATION") {
  return prisma.userEmailVerification.findFirst({
    where: { userId, purpose },
    orderBy: { createdAt: "desc" },
  });
}

export function incrementVerificationAttempts(id) {
  return prisma.userEmailVerification.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  });
}

export function consumeVerification(id) {
  return prisma.userEmailVerification.update({
    where: { id },
    data: { consumedAt: new Date() },
  });
}

// --- Refresh tokens ----------------------------------------------------------

export function createRefreshToken({ userId, tokenHash, expiresAt, userAgent, ip }) {
  return prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt, userAgent, ip },
  });
}

export function findRefreshTokenByHash(tokenHash) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

export function rotateRefreshToken({ oldId, newId }) {
  return prisma.refreshToken.update({
    where: { id: oldId },
    data: { revokedAt: new Date(), replacedById: newId },
  });
}

export function revokeRefreshToken(id) {
  return prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

/** Reuse of an already-rotated token means the token was stolen — kill every
 * active session for this user, not just the one presented. */
export function revokeAllRefreshTokensForUser(userId) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
