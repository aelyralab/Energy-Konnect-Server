/**
 * Server-side enforcement of the two-article guest limit (context doc §5;
 * IMPLEMENTATION_PLAN.md §0.2.6). Re-reading an already-read article never
 * counts again — only a *distinct* third article is blocked.
 *
 * Must be mounted after `optionalAuth` on the article-detail route:
 * authenticated readers (`req.user` set) are exempt entirely, since the
 * limit only exists to push anonymous visitors toward registering.
 *
 * Deliberately a separate lightweight lookup here rather than reusing the
 * full article fetch the controller performs afterwards — this keeps access
 * control (can this request proceed?) separate from data assembly (what does
 * the response contain?), per the layered architecture in
 * IMPLEMENTATION_PLAN.md §37. The extra query is one indexed lookup by slug.
 */
import crypto from "node:crypto";
import ApiError from "../utils/ApiError.js";
import prisma from "../config/db.js";
import env, { isProduction } from "../config/env.js";

const GUEST_COOKIE_NAME = "ek_guest";
// Chrome caps Set-Cookie Max-Age at 400 days regardless of what's requested.
const GUEST_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

function guestCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    signed: true,
    path: "/",
    domain: env.COOKIE_DOMAIN,
    maxAge: GUEST_COOKIE_MAX_AGE_MS,
  };
}

export async function guestLimit(req, res, next) {
  try {
    if (req.user) return next(); // signed-in readers are never limited

    if (env.GUEST_ARTICLE_LIMIT <= 0) return next(); // limit disabled

    const article = await prisma.article.findUnique({
      where: { slug: req.params.slug },
      select: { id: true, status: true },
    });
    // Not found, or not published: let the controller's own PUBLISHED-only
    // query produce the real 404 — this middleware only ever blocks, it
    // never explains away a slug that doesn't resolve.
    if (!article || article.status !== "PUBLISHED") return next();

    let guestId = req.signedCookies?.[GUEST_COOKIE_NAME];
    if (!guestId) {
      guestId = crypto.randomUUID();
      res.cookie(GUEST_COOKIE_NAME, guestId, guestCookieOptions());
    }

    const alreadyRead = await prisma.guestRead.findUnique({
      where: { guestId_articleId: { guestId, articleId: article.id } },
    });
    if (alreadyRead) return next();

    const distinctReadCount = await prisma.guestRead.count({ where: { guestId } });
    if (distinctReadCount >= env.GUEST_ARTICLE_LIMIT) {
      return next(
        ApiError.unauthorized(
          "You've reached the free article limit — create an account to keep reading",
          "GUEST_LIMIT_REACHED",
        ),
      );
    }

    await prisma.guestRead.create({ data: { guestId, articleId: article.id } });
    return next();
  } catch (error) {
    return next(error);
  }
}

export default guestLimit;
