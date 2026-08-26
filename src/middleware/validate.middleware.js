/**
 * Request validation.
 *
 * `validate({ body, query, params })` replaces each validated segment with the
 * *parsed* result, so controllers receive coerced, stripped data — a query
 * `?page=2` arrives as the number 2, and unknown keys are gone. Anything a
 * schema does not declare cannot reach a service.
 */
import ApiError from "../utils/ApiError.js";

const SEGMENTS = ["body", "query", "params"];

export function validate(schemas) {
  return (req, _res, next) => {
    const issues = [];
    const parsed = {};

    for (const segment of SEGMENTS) {
      const schema = schemas[segment];
      if (!schema) continue;

      const result = schema.safeParse(req[segment]);
      if (result.success) {
        parsed[segment] = result.data;
      } else {
        issues.push(
          ...result.error.issues.map((issue) => ({
            field: [segment, ...issue.path].join("."),
            message: issue.message,
            code: issue.code,
          })),
        );
      }
    }

    if (issues.length > 0) {
      return next(
        ApiError.unprocessable("The request did not pass validation", issues, "VALIDATION_ERROR"),
      );
    }

    for (const [segment, value] of Object.entries(parsed)) {
      // Express 4 allows reassigning req.query/params; Express 5 makes them
      // getter-only, hence defineProperty rather than plain assignment.
      Object.defineProperty(req, segment, { value, writable: true, configurable: true });
    }

    return next();
  };
}

export default validate;
