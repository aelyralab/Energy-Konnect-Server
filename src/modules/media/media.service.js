import crypto from "node:crypto";
import path from "node:path";
import ApiError from "../../utils/ApiError.js";
import logger from "../../config/logger.js";
import { uploadFile, deleteFile } from "../../services/storage/index.js";
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

function describeUsage(usage) {
  const parts = [];
  if (usage.covers > 0) parts.push(`${usage.covers} cover image use(s)`);
  if (usage.pdfs > 0) parts.push(`${usage.pdfs} PDF attachment use(s)`);
  if (usage.versionCovers > 0) parts.push(`${usage.versionCovers} draft/revision cover use(s)`);
  if (usage.versionPdfs > 0) parts.push(`${usage.versionPdfs} draft/revision PDF use(s)`);
  if (usage.authorImages > 0) parts.push(`${usage.authorImages} editorial author image use(s)`);
  if (usage.blocks > 0) parts.push(`${usage.blocks} embedded content block use(s)`);
  return parts.join(", ");
}

/**
 * Deletes as many of the given media assets as are safe to delete, and
 * reports the rest rather than failing the whole batch — a multi-select
 * cleanup of dozens of uploads shouldn't be blocked by the one still-in-use
 * asset among them. Each surviving deletion removes the storage file too
 * (best-effort: a storage failure is logged and doesn't stop the others,
 * since a dangling database row is worse than an orphaned Cloudinary file).
 */
export async function deleteMany(ids) {
  const deleted = [];
  const skipped = [];

  for (const id of ids) {
    const media = await repo.findById(id);
    if (!media) {
      skipped.push({ id, reason: "Not found" });
      continue;
    }

    const usage = await repo.findUsage(id);
    const reason = describeUsage(usage);
    if (reason) {
      skipped.push({ id, fileName: media.fileName, reason: `Still in use — ${reason}` });
      continue;
    }

    await repo.remove(id);
    try {
      await deleteFile({ storageKey: media.storageKey, mimeType: media.mimeType });
    } catch (error) {
      logger.warn(
        { err: error.message, mediaId: id },
        "database row deleted but the storage file could not be removed",
      );
    }
    deleted.push(id);
  }

  return { deleted, skipped };
}
