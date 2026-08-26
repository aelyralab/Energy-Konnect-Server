import { checkDatabase } from "../../config/db.js";
import { checkRedis } from "../../config/redis.js";
import env from "../../config/env.js";

/**
 * Reports each dependency separately.
 *
 * Redis being "disabled" or "error" is degraded, not down — the API serves every
 * request without it. Only the database failing makes the service unhealthy,
 * which is what a load balancer should act on.
 */
export async function getHealth() {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);

  const status =
    database.status === "ok" ? (redis.status === "error" ? "degraded" : "ok") : "error";

  return {
    status,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: { database, redis },
  };
}
