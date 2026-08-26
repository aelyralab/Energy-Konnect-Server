/**
 * Role authorization. Always mounted after `requireAuth` — this only checks
 * `req.user.role`, it does not authenticate. Ownership checks (a PUBLISHER
 * editing someone else's draft) are a separate, per-route concern that lives
 * in the service layer, not here (IMPLEMENTATION_PLAN.md §37/§49: "Backend
 * authorization does not rely on frontend role checks", and ownership is
 * checked in the service, never the route).
 */
import ApiError from "../utils/ApiError.js";

/** @param {...("USER"|"PUBLISHER"|"ADMIN")} roles */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized("Authentication required", "UNAUTHORIZED"));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(`This action requires one of: ${roles.join(", ")}`, "FORBIDDEN_ROLE"),
      );
    }
    return next();
  };
}

export default requireRole;
