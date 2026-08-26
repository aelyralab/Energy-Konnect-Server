/**
 * Application error type.
 *
 * Services throw these; the error middleware is the only place that turns them
 * into HTTP. `code` is a stable machine-readable string — the client branches on
 * it (GUEST_LIMIT_REACHED vs a plain 401) instead of matching message text.
 */
export class ApiError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expected = true; // distinguishes deliberate errors from crashes
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message, details, code = "BAD_REQUEST") {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(message = "Authentication required", code = "UNAUTHORIZED") {
    return new ApiError(401, code, message);
  }

  static forbidden(
    message = "You do not have permission to perform this action",
    code = "FORBIDDEN",
  ) {
    return new ApiError(403, code, message);
  }

  static notFound(message = "Resource not found", code = "NOT_FOUND") {
    return new ApiError(404, code, message);
  }

  static conflict(message, code = "CONFLICT", details) {
    return new ApiError(409, code, message, details);
  }

  static unprocessable(message, details, code = "UNPROCESSABLE_ENTITY") {
    return new ApiError(422, code, message, details);
  }

  static tooManyRequests(message = "Too many requests", details, code = "RATE_LIMITED") {
    return new ApiError(429, code, message, details);
  }

  static internal(message = "Something went wrong", code = "INTERNAL_ERROR") {
    return new ApiError(500, code, message);
  }
}

export default ApiError;
