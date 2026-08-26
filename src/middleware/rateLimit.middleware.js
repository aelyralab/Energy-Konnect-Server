/**
 * Fixed-window rate limiting, keyed by whatever the caller derives from the
 * request (IP, email, IP+email, ...). Backed by Redis when available so
 * limits are shared across processes; falls back to an in-process Map when
 * Redis is down, which is per-instance and resets on restart but still stops
 * a tight retry loop — degraded, not disabled (matches config/redis.js's
 * "Redis is optional" contract).
 *
 * Used for auth endpoints specifically because they are the ones an attacker
 * scripts directly: login (credential stuffing), register/resend-otp (mail
 * bombing someone else's inbox), verify-otp (brute-forcing a 6-digit code).
 */
import ApiError from "../utils/ApiError.js";
import { withRedis } from "../config/redis.js";

const memoryStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt <= now) memoryStore.delete(key);
  }
}, 60_000).unref();

async function incrementMemory(key, windowSeconds) {
  const now = Date.now();
  const existing = memoryStore.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000;
    memoryStore.set(key, { count: 1, resetAt });
    return { count: 1, resetAt };
  }
  existing.count += 1;
  return existing;
}

async function incrementRedis(redis, key, windowSeconds) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  const ttl = await redis.ttl(key);
  return { count, resetAt: Date.now() + Math.max(ttl, 1) * 1000 };
}

/**
 * @param {object} options
 * @param {string} options.name - unique namespace for this limiter (e.g. "login")
 * @param {number} options.windowSeconds
 * @param {number} options.max - requests allowed per window
 * @param {(req: import('express').Request) => string} [options.keyFn] - defaults to req.ip
 */
export function rateLimit({ name, windowSeconds, max, keyFn }) {
  return async (req, res, next) => {
    const identity = keyFn ? keyFn(req) : req.ip;
    const key = `ratelimit:${name}:${identity}`;

    const redisResult = await withRedis((redis) => incrementRedis(redis, key, windowSeconds));
    const result = redisResult ?? (await incrementMemory(key, windowSeconds));

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - result.count)));

    if (result.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return next(
        ApiError.tooManyRequests("Too many requests — please try again later", {
          retryAfterSeconds,
        }),
      );
    }

    return next();
  };
}

export const emailKey = (req) => String(req.body?.email ?? req.ip).toLowerCase();

export default rateLimit;
