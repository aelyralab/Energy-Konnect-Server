/**
 * The single place errors become HTTP responses.
 *
 * Nothing else in the codebase should call `res.status(4xx)` on a failure path.
 * Unrecognised errors are logged with their stack and reported to the client as
 * a bare 500 — internal messages are never echoed back, since they routinely
 * name tables, columns and file paths.
 */
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import ApiError from "../utils/ApiError.js";
import { sendError } from "../utils/respond.js";
import logger from "../config/logger.js";
import { isProduction } from "../config/env.js";

function fromZodError(error) {
  return {
    status: 422,
    code: "VALIDATION_ERROR",
    message: "The request did not pass validation",
    details: error.issues.map((issue) => ({
      field: issue.path.join(".") || "(root)",
      message: issue.message,
      code: issue.code,
    })),
  };
}

function fromPrismaKnownError(error) {
  switch (error.code) {
    case "P2002": {
      const fields = error.meta?.target;
      const list = Array.isArray(fields) ? fields.join(", ") : (fields ?? "value");
      return {
        status: 409,
        code: "DUPLICATE_VALUE",
        message: `A record with this ${list} already exists`,
        details: Array.isArray(fields) ? fields.map((field) => ({ field })) : undefined,
      };
    }
    case "P2025":
      return { status: 404, code: "NOT_FOUND", message: "Resource not found" };
    case "P2003":
      return {
        status: 409,
        code: "FOREIGN_KEY_CONSTRAINT",
        message: "A referenced record does not exist, or is still in use",
      };
    case "P2014":
      return {
        status: 409,
        code: "RELATION_CONSTRAINT",
        message: "This change would break a required relationship",
      };
    case "P2000":
      return { status: 400, code: "VALUE_TOO_LONG", message: "A submitted value is too long" };
    default:
      return null;
  }
}

/** Body-parser and JWT failures arrive as plain Errors with recognisable shapes. */
function fromWellKnownError(error) {
  if (error.type === "entity.parse.failed") {
    return { status: 400, code: "MALFORMED_JSON", message: "Request body is not valid JSON" };
  }
  if (error.type === "entity.too.large") {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" };
  }
  if (error.name === "TokenExpiredError") {
    return { status: 401, code: "TOKEN_EXPIRED", message: "Access token has expired" };
  }
  if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
    return { status: 401, code: "INVALID_TOKEN", message: "Access token is invalid" };
  }
  return null;
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export function errorMiddleware(error, req, res, next) {
  let mapped = null;

  if (error instanceof ApiError) {
    mapped = {
      status: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  } else if (error instanceof ZodError) {
    mapped = fromZodError(error);
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    mapped = fromPrismaKnownError(error);
  } else if (error instanceof Prisma.PrismaClientValidationError) {
    mapped = { status: 400, code: "INVALID_QUERY", message: "The request could not be processed" };
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    mapped = { status: 503, code: "DATABASE_UNAVAILABLE", message: "The database is unavailable" };
  } else {
    mapped = fromWellKnownError(error);
  }

  if (!mapped) {
    mapped = { status: 500, code: "INTERNAL_ERROR", message: "Something went wrong" };
  }

  const log = req.log ?? logger;
  if (mapped.status >= 500) {
    log.error({ err: error, code: mapped.code }, `${mapped.code}: ${error.message}`);
  } else {
    log.warn({ code: mapped.code, path: req.originalUrl }, `${mapped.code}: ${error.message}`);
  }

  // Outside production, surface the real message and stack for a 500 — hiding
  // them during development just means reading the terminal instead.
  if (mapped.status >= 500 && !isProduction) {
    mapped.details = {
      originalMessage: error.message,
      stack: error.stack?.split("\n").slice(0, 8),
    };
  }

  return sendError(res, mapped);
}

export default errorMiddleware;
