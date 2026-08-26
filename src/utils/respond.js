/**
 * The response envelope, in one place.
 *
 *   success  { "data": ..., "meta": { ... } }
 *   error    { "error": { "code", "message", "details" } }
 *
 * Controllers call these rather than `res.json` directly so the shape cannot
 * drift endpoint by endpoint.
 */

export function sendData(res, data, { status = 200, meta } = {}) {
  const body = { data };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}

export function sendCreated(res, data, meta) {
  return sendData(res, data, { status: 201, meta });
}

export function sendNoContent(res) {
  return res.status(204).send();
}

/**
 * @param {object} page - { page, limit, total } from the repository
 */
export function sendPaginated(res, items, { page, limit, total }) {
  return sendData(res, items, {
    meta: {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    },
  });
}

export function sendError(res, { status, code, message, details }) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return res.status(status).json({ error });
}
