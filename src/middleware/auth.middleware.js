/**
 * Access-token authentication. The token is a JWT (see utils/jwt.js) sent as
 * `Authorization: Bearer <token>` — never read from a cookie, so a CSRF token
 * is unnecessary for anything this middleware guards (the refresh endpoint is
 * the one cookie-based exception, and it only ever rotates/revokes, never
 * mutates application data).
 */
import ApiError from "../utils/ApiError.js";
import { verifyAccessToken } from "../utils/jwt.js";
import prisma from "../config/db.js";

function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/**
 * Verifies the token and loads the *current* user row — role/isActive checks
 * must reflect what's true now, not what was true when the token was issued.
 * A JWT claiming role=PUBLISHER for a user an admin just demoted is exactly
 * the case this guards against.
 */
async function loadRequestUser(token) {
  const payload = verifyAccessToken(token); // throws on invalid/expired

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw ApiError.unauthorized("Account no longer exists", "ACCOUNT_NOT_FOUND");
  }
  if (!user.isActive) {
    throw ApiError.forbidden("This account has been deactivated", "ACCOUNT_DEACTIVATED");
  }
  return user;
}

/** Rejects the request unless a valid access token is present. */
export async function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthorized("Authentication required", "UNAUTHORIZED"));

  try {
    req.user = await loadRequestUser(token);
    return next();
  } catch (error) {
    return next(error);
  }
}

/** Attaches req.user if a valid token is present; never rejects the request. */
export async function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    req.user = await loadRequestUser(token);
  } catch {
    // An absent/expired/invalid token degrades to "guest", not an error —
    // that's the entire point of "optional".
  }
  return next();
}

export default requireAuth;
