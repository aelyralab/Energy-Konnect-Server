import asyncHandler from "../../utils/asyncHandler.js";
import { sendData, sendCreated, sendNoContent } from "../../utils/respond.js";
import { serializeUser } from "../../utils/serializers/user.serializer.js";
import env, { isProduction } from "../../config/env.js";
import * as authService from "./auth.service.js";

const REFRESH_COOKIE_NAME = "ek_refresh";
// Scoped to /api/auth: the browser only ever sends this cookie to refresh and
// logout, not to every request — smaller blast radius if it were ever misused
// from injected content elsewhere on the API surface.
const REFRESH_COOKIE_PATH = "/api/auth";

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    // Cross-site in production (client on a different registrable domain than
    // the API) — "none" is required for the cookie to ride along on fetch()
    // at all, and browsers only honor "none" when paired with Secure.
    sameSite: isProduction ? "none" : "lax",
    signed: true,
    path: REFRESH_COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

function setRefreshCookie(res, value) {
  res.cookie(REFRESH_COOKIE_NAME, value, refreshCookieOptions());
}

function clearRefreshCookie(res) {
  const { maxAge: _maxAge, ...clearOptions } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
}

function sessionContext(req) {
  return { userAgent: req.headers["user-agent"], ip: req.ip };
}

function sendSession(res, { user, accessToken, refreshTokenValue }, status = 200) {
  setRefreshCookie(res, refreshTokenValue);
  return sendData(res, { user: serializeUser(user), accessToken }, { status });
}

/** POST /api/auth/register */
export const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  return sendCreated(res, {
    user: serializeUser(user),
    message: "Account created. Check your email for a verification code.",
  });
});

/** POST /api/auth/verify-otp */
export const verifyOtp = asyncHandler(async (req, res) => {
  const result = await authService.verifyOtp(req.body, sessionContext(req));
  return sendSession(res, result);
});

/** POST /api/auth/resend-otp */
export const resendOtp = asyncHandler(async (req, res) => {
  await authService.resendOtp(req.body.email);
  return sendData(res, {
    message: "If that email is registered and not yet verified, a new code has been sent.",
  });
});

/** POST /api/auth/login */
export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, sessionContext(req));
  return sendSession(res, result);
});

/** POST /api/auth/refresh */
export const refresh = asyncHandler(async (req, res) => {
  const token = req.signedCookies?.[REFRESH_COOKIE_NAME];
  const result = await authService.refresh(token, sessionContext(req));
  return sendSession(res, result);
});

/** POST /api/auth/logout */
export const logout = asyncHandler(async (req, res) => {
  const token = req.signedCookies?.[REFRESH_COOKIE_NAME];
  await authService.logout(token);
  clearRefreshCookie(res);
  return sendNoContent(res);
});

/** GET /api/auth/me */
export const me = asyncHandler(async (req, res) => {
  return sendData(res, { user: serializeUser(req.user) });
});
