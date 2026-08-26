/**
 * HTTP entrypoint: binds the port and owns shutdown.
 *
 * On SIGTERM the server stops accepting connections, lets in-flight requests
 * finish, then closes the database and Redis. A hard exit mid-transaction is how
 * you get a half-applied publish.
 */
import http from "node:http";
import app from "./app.js";
import env from "./config/env.js";
import logger from "./config/logger.js";
import prisma, { disconnectDatabase } from "./config/db.js";
import { disconnectRedis } from "./config/redis.js";

const server = http.createServer(app);

// Neon can take a moment to wake suspended compute; don't cut off a slow request.
server.headersTimeout = 65_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 61_000;

async function start() {
  try {
    await prisma.$connect();
    logger.info("database connected");
  } catch (error) {
    // Not fatal: the API should still boot so /api/health can *report* the
    // outage. A server that refuses to start is a server you cannot diagnose.
    logger.error({ err: error.message }, "database connection failed — starting anyway");
  }

  server.listen(env.PORT, () => {
    logger.info(`Energy Konnect API listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
  });
}

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down`);

  const forceExit = setTimeout(() => {
    logger.error("graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  server.close(async (error) => {
    if (error) logger.error({ err: error.message }, "error closing http server");
    try {
      await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
      logger.info("shutdown complete");
      process.exit(error ? 1 : 0);
    } catch (closeError) {
      logger.error({ err: closeError.message }, "error during shutdown");
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  // Process state is unknown after this point — log, then leave.
  logger.fatal({ err: error }, "uncaught exception — exiting");
  shutdown("uncaughtException").finally(() => process.exit(1));
});

start();
