/**
 * Email outbox worker process — run separately from the API
 * (`npm run worker`), never inside a request handler (context doc §39: "Do
 * not send large batches of emails synchronously inside the HTTP request").
 *
 * A polling loop, not a queue consumer: no BullMQ, no dependency on Redis
 * being up. IMPLEMENTATION_PLAN.md §0.4 explicitly allows this — the outbox
 * table is the real source of truth, Redis was only ever going to be an
 * optimization to poll less often, and skipping it entirely keeps this
 * process correct even when Redis is unavailable. The poll interval
 * (EMAIL_OUTBOX_POLL_INTERVAL_MS) doubles as the retry backoff between an
 * email's attempts.
 *
 * setTimeout-chained, not setInterval — a slow drain (many emails, a slow
 * provider) can never overlap with the next tick this way.
 */
import env from "./config/env.js";
import logger from "./config/logger.js";
import prisma, { disconnectDatabase } from "./config/db.js";
import { disconnectRedis } from "./config/redis.js";
import { drainOutbox } from "./jobs/emailOutbox.worker.js";

let shuttingDown = false;
let timer = null;

async function tick() {
  if (shuttingDown) return;

  try {
    const result = await drainOutbox();
    if (result.claimed > 0) {
      logger.info(result, "email outbox drained");
    }
  } catch (error) {
    logger.error({ err: error.message }, "email outbox drain failed");
  }

  if (!shuttingDown) {
    timer = setTimeout(tick, env.EMAIL_OUTBOX_POLL_INTERVAL_MS);
  }
}

async function start() {
  await prisma.$connect();
  logger.info(
    `email outbox worker started — polling every ${env.EMAIL_OUTBOX_POLL_INTERVAL_MS / 1000}s`,
  );
  await tick();
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — worker shutting down`);

  if (timer) clearTimeout(timer);
  await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection in worker");
});

start();
