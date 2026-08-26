/**
 * Multer, in-memory. The buffer goes straight to the storage adapter
 * (services/storage) — nothing here ever touches disk itself, so the same
 * middleware works whether STORAGE_PROVIDER ends up being local or
 * Cloudinary. The size cap here is a coarse first line of defense (rejects
 * an oversized upload before it's even fully buffered); the precise
 * per-type limits live in media.service.js, which knows whether the file is
 * an image or a PDF.
 */
import multer from "multer";
import ApiError from "../utils/ApiError.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // the larger of the two per-type caps

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

export function uploadSingle(fieldName = "file") {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        return next(ApiError.badRequest(error.message, undefined, "UPLOAD_ERROR"));
      }
      if (error) return next(error);
      if (!req.file) {
        return next(ApiError.badRequest("No file uploaded", { field: fieldName }, "NO_FILE"));
      }
      return next();
    });
  };
}

export default uploadSingle;
