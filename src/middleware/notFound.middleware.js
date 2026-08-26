import ApiError from "../utils/ApiError.js";

/** Terminal route: anything that reached here matched no router. */
export function notFoundMiddleware(req, _res, next) {
  next(new ApiError(404, "ROUTE_NOT_FOUND", `No route matches ${req.method} ${req.originalUrl}`));
}

export default notFoundMiddleware;
