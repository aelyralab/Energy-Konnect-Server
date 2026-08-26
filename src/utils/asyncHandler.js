/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware. Express 4 does not forward async rejections on its own — without
 * this an awaited throw becomes a hung request, not a 500.
 */
export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export default asyncHandler;
