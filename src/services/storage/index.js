/**
 * Storage provider facade — mirrors services/email/index.js. Every caller
 * imports from here, never from a specific provider file, so switching
 * providers is a one-line env change (IMPLEMENTATION_PLAN.md §0.1).
 */
import env from "../../config/env.js";
import localProvider from "./local.provider.js";
import cloudinaryProvider from "./cloudinary.provider.js";

const PROVIDERS = { local: localProvider, cloudinary: cloudinaryProvider };
const activeProvider = PROVIDERS[env.STORAGE_PROVIDER];

/**
 * @param {{buffer: Buffer, storageKey: string, mimeType: string}} params
 * @returns {Promise<{storageKey: string, url: string, width?: number, height?: number}>}
 */
export async function uploadFile(params) {
  return activeProvider.uploadFile(params);
}

export default { uploadFile };
