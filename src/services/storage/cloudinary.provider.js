/**
 * Production file storage via Cloudinary. Images upload as Cloudinary
 * "image" resources (which is where width/height come from in the response,
 * no separate dimension probe needed); PDFs upload as "raw" resources since
 * they aren't a media type Cloudinary transforms.
 */
import { v2 as cloudinary } from "cloudinary";
import env from "../../config/env.js";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export async function uploadFile({ buffer, storageKey, mimeType }) {
  ensureConfigured();
  const resourceType = mimeType === "application/pdf" ? "raw" : "image";
  const publicId = storageKey.replace(/\.[^./]+$/, "");

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: resourceType, folder: "energy-konnect" },
      (error, uploadResult) => (error ? reject(error) : resolve(uploadResult)),
    );
    stream.end(buffer);
  });

  return {
    storageKey: result.public_id,
    url: result.secure_url,
    width: result.width,
    height: result.height,
  };
}

export default { uploadFile };
