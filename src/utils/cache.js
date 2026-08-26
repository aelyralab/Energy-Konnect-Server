/**
 * Read-through cache for cheap, rarely-changing public reads (taxonomy lists
 * today; any similar list can reuse this). Transparent when Redis is down —
 * `withRedis` already degrades to `null`, so `cached()` just calls `loader`
 * every time instead of failing.
 */
import { withRedis } from "../config/redis.js";

export async function cached(key, ttlSeconds, loader) {
  const hit = await withRedis((redis) => redis.get(key));
  if (hit) return JSON.parse(hit);

  const value = await loader();
  await withRedis((redis) => redis.set(key, JSON.stringify(value), "EX", ttlSeconds));
  return value;
}

export async function invalidate(...keys) {
  if (keys.length === 0) return;
  await withRedis((redis) => redis.del(...keys));
}
