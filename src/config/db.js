/**
 * Prisma client singleton.
 *
 * `--watch` in development re-imports modules on every save; without the global
 * cache each reload would open a new connection pool until Postgres refuses.
 */
import { PrismaClient } from "@prisma/client";
import env, { isDevelopment, isProduction } from "./env.js";
import logger from "./logger.js";

const createClient = () =>
  new PrismaClient({
    log: isProduction
      ? [{ emit: "event", level: "error" }]
      : [
          { emit: "event", level: "error" },
          { emit: "event", level: "warn" },
        ],
    datasources: { db: { url: env.DATABASE_URL } },
  });

const globalForPrisma = globalThis;

const prisma = globalForPrisma.__energyKonnectPrisma ?? createClient();

if (isDevelopment) {
  globalForPrisma.__energyKonnectPrisma = prisma;
}

prisma.$on("error", (event) => logger.error({ prisma: event }, "prisma error"));
if (!isProduction) {
  prisma.$on("warn", (event) => logger.warn({ prisma: event }, "prisma warning"));
}

/**
 * Cheap liveness probe for the health endpoint.
 * Neon suspends idle compute, so the first call after a pause can take a
 * second or two — that is a cold start, not a failure.
 */
export async function checkDatabase() {
  const startedAt = process.hrtime.bigint();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    return { status: "ok", latencyMs: Math.round(latencyMs) };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}

export default prisma;
