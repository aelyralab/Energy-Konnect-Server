import asyncHandler from "../../utils/asyncHandler.js";
import { sendData } from "../../utils/respond.js";
import * as healthService from "./health.service.js";

/** GET /api/health */
export const getHealth = asyncHandler(async (_req, res) => {
  const health = await healthService.getHealth();
  const status = health.status === "error" ? 503 : 200;
  return sendData(res, health, { status });
});

/** GET /api/health/live — process is up. No dependency checks. */
export const getLiveness = asyncHandler(async (_req, res) => {
  return sendData(res, { status: "ok" });
});
