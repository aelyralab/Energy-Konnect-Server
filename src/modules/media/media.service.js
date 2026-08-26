import crypto from "node:crypto";
import path from "node:path";
import ApiError from "../../utils/ApiError.js";
import { uploadFile } from "../../services/storage/index.js";
import * as repo from "./media.repository.js";

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_PDF_MIME_TYPES = new Set(["application/pdf"]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // cover images, figures
const MAX_PDF_BYTES = 25 * 1024 * 1024; // full issue PDFs

function assertValid({ mimetype, size }) {
  if (ALLOWED_IMAGE_MIME_TYPES.has(mimetype)) {
    if (size > MAX_IMAGE_BYTES) {
      throw ApiError.badRequest(
        `Image exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)}MB limit`,
        { field: "file" },
        "FILE_TOO_LARGE",
      );
    }
    return;
  }

  if (ALLOWED_PDF_MIME_TYPES.has(mimetype)) {
    if (size > MAX_PDF_BYTES) {
      throw ApiError.badRequest(
        `PDF exceeds the ${MAX_PDF_BYTES / (1024 * 1024)}MB limit`,
        { field: "file" },
        "FILE_TOO_LARGE",
      );
    }
    return;
  }

  throw ApiError.badRequest(
    `Unsupported file type: ${mimetype}. Allowed: JPEG, PNG, WebP, GIF, PDF.`,
    { field: "file" },
    "UNSUPPORTED_FILE_TYPE",
  );
}

/** @param {{file: Express.Multer.File, uploadedBy: string}} params */
export async function uploadMedia({ file, uploadedBy }) {
  assertValid(file);

  // Random, not derived from the original filename — avoids path traversal,
  // collisions, and leaking the uploader's local filesystem naming.
  const storageKey = `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
  const uploaded = await uploadFile({ buffer: file.buffer, storageKey, mimeType: file.mimetype });

  return repo.create({
    fileName: file.originalname,
    storageKey: uploaded.storageKey,
    url: uploaded.url,
    mimeType: file.mimetype,
    fileSize: file.size,
    width: uploaded.width ?? null,
    height: uploaded.height ?? null,
    uploadedBy,
  });
}

export async function getById(id) {
  const media = await repo.findById(id);
  if (!media) throw ApiError.notFound("Media not found");
  return media;
}

export async function listAll(query) {
  const { items, total } = await repo.findAll(query);
  return { items, total, page: query.page, limit: query.limit };
}
