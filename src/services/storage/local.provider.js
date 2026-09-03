/**
 * Development file storage: writes to disk under LOCAL_UPLOAD_DIR. Served
 * back out at `/uploads/*` (see app.js) — disallowed in production by
 * env.js's cross-field check, so this only ever runs where that static
 * mount is appropriate.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { imageSize } from "image-size";
import env from "../../config/env.js";
import logger from "../../config/logger.js";

const UPLOAD_DIR = path.resolve(process.cwd(), env.LOCAL_UPLOAD_DIR);

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

function probeImageDimensions(buffer, mimeType) {
  if (!mimeType.startsWith("image/")) return {};
  try {
    const { width, height } = imageSize(buffer);
    return { width, height };
  } catch (error) {
    // Not fatal — a corrupt or unusual file still gets stored, just without
    // dimensions; the block schema doesn't require them.
    logger.warn({ err: error.message }, "could not probe image dimensions");
    return {};
  }
}

export async function uploadFile({ buffer, storageKey, mimeType }) {
  await ensureUploadDir();
  await fs.writeFile(path.join(UPLOAD_DIR, storageKey), buffer);

  return {
    storageKey,
    url: `/uploads/${storageKey}`,
    ...probeImageDimensions(buffer, mimeType),
  };
}

export async function deleteFile({ storageKey }) {
  try {
    await fs.unlink(path.join(UPLOAD_DIR, storageKey));
  } catch (error) {
    // Already gone (or never written) — deleting the database row should
    // still succeed rather than get stuck on a file that isn't there.
    if (error.code !== "ENOENT") throw error;
  }
}

export default { uploadFile, deleteFile };
