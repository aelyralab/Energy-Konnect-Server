/**
 * Express application.
 *
 * Exported without listening so tests can hand it straight to supertest.
 * `server.js` owns the port and the lifecycle.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";

import env, { isProduction, isTest } from "./config/env.js";
import logger from "./config/logger.js";
import apiRoutes from "./routes/index.js";
import notFoundMiddleware from "./middleware/notFound.middleware.js";
import errorMiddleware from "./middleware/error.middleware.js";

const app = express();

// Behind a proxy (Render, Railway, Fly), req.ip and secure-cookie detection are
// wrong unless Express is told to read X-Forwarded-*. Off by default: trusting
// those headers when *not* behind a proxy lets a client spoof its own IP and
// walk straight through per-IP rate limits.
if (env.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

// --- Security ---------------------------------------------------------------
app.use(
  helmet({
    // The API serves JSON, not documents; CSP belongs on the frontend host.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

const allowedOrigins = env.CLIENT_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: same-origin, curl, or a server-to-server call.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn({ origin }, "blocked cors origin");
      return callback(null, false);
    },
    // Refresh tokens ride in an httpOnly cookie, so the browser must be allowed
    // to send credentials cross-origin.
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 86_400,
  }),
);

// --- Request plumbing -------------------------------------------------------
app.use(compression());
app.use(express.json({ limit: "2mb" })); // article payloads carry many blocks
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser(env.COOKIE_SECRET));

app.use(
  pinoHttp({
    logger,
    genReqId(req, res) {
      const existing = req.headers["x-request-id"];
      const id = typeof existing === "string" && existing.length <= 64 ? existing : randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    autoLogging: {
      // Health checks would otherwise dominate the log.
      ignore: (req) => isTest || req.url === "/api/health/live",
    },
    customLogLevel(_req, res, error) {
      if (error || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage(req, res) {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
    customErrorMessage(req, res) {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
  }),
);

// --- Routes -----------------------------------------------------------------
app.get("/", (_req, res) => {
  res.json({
    data: {
      name: "Energy Konnect API",
      version: "1.0.0",
      environment: isProduction ? "production" : env.NODE_ENV,
      docs: "/api/health",
    },
  });
});

// Local media storage only — env.js forbids STORAGE_PROVIDER=local in
// production, so this mount is a no-op (never reached with real traffic)
// there. Files are served by their random storageKey, not the original
// filename — see media.service.js.
if (env.STORAGE_PROVIDER === "local") {
  app.use("/uploads", express.static(path.resolve(process.cwd(), env.LOCAL_UPLOAD_DIR)));
}

// Cover art for the seeded articles. prisma/seed.js points its placeholder
// MediaAssets at /seed-media/<file>, so without this mount every seeded
// article's coverImage URL resolves to a 404.
app.use("/seed-media", express.static(path.resolve(process.cwd(), "seed-media")));

app.use("/api", apiRoutes);

// --- Tail --------------------------------------------------------------------
app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
