/**
 * Redis connection (ioredis).
 *
 * Redis is *optional*. It backs caching and rate-limit counters, and neither is
 * load-bearing for correctness — a Redis outage must degrade the API, never
 * take it down. Callers check `isRedisAvailable()` and fall back.
 *
 * `rediss://` URLs (Upstash) enable TLS automatically.
 */
import Redis from "ioredis";
import env, { isTest } from "./env.js";
import logger from "./logger.js";

let client = null;
let connected = false;
let warnedUnavailable = false;

if (env.REDIS_URL && !isTest) {
  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    // Fail commands fast instead of buffering them while the server is down.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });

  client.on("connect", () => {
    connected = true;
    warnedUnavailable = false;
    logger.info("redis connected");
  });

  client.on("error", (error) => {
    connected = false;
    // ioredis retries continuously; logging every attempt would flood the log.
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      logger.warn({ err: error.message }, "redis unavailable — running without cache");
    }
  });

  client.on("close", () => {
    connected = false;
  });

  client.connect().catch(() => {
    // Already reported by the error handler above.
  });
} else if (!env.REDIS_URL) {
  logger.warn("REDIS_URL not set — caching and distributed rate limiting are disabled");
}

export function isRedisAvailable() {
  return client !== null && connected;
}

/**
 * Run a Redis command, returning `fallback` if Redis is unreachable.
 * Keeps every call site free of try/catch noise.
 */
export async function withRedis(operation, fallback = null) {
  if (!isRedisAvailable()) return fallback;
  try {
    return await operation(client);
  } catch (error) {
    logger.warn({ err: error.message }, "redis command failed");
    return fallback;
  }
}

export async function checkRedis() {
  if (!env.REDIS_URL) return { status: "disabled" };
  if (!client) return { status: "disabled" };

  const startedAt = process.hrtime.bigint();
  try {
    await client.ping();
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    return { status: "ok", latencyMs: Math.round(latencyMs) };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

export async function disconnectRedis() {
  if (client) {
    await client.quit().catch(() => client.disconnect());
  }
}

export default client;
