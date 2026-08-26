/**
 * The media module has been exercised manually (over real HTTP with
 * multipart uploads) since Phase 5 but never had an automated test — this
 * closes that gap and specifically proves §45 rules 25/26: files are
 * stored outside PostgreSQL, and only metadata/a URL reference is kept.
 *
 * A plain object matching Multer's file shape stands in for a real upload —
 * mediaService.uploadMedia() only ever reads {originalname, mimetype,
 * size, buffer} off it, the same fields Multer's memoryStorage produces,
 * so there's nothing multipart/form-data or supertest would add here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "../../src/config/db.js";
import { retireTestUsers } from "../helpers/users.js";
import { hashPassword } from "../../src/utils/password.js";
import * as mediaService from "../../src/modules/media/media.service.js";

let uploaderId;
const createdMediaIds = [];
const createdUserIds = [];

// A real 1x1 transparent PNG — the local storage provider probes real image
// dimensions from the bytes, so a fake/empty buffer would just fail there.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function fakeFile(overrides = {}) {
  return {
    originalname: "test.png",
    mimetype: "image/png",
    size: ONE_PIXEL_PNG.length,
    buffer: ONE_PIXEL_PNG,
    ...overrides,
  };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: "Phase 11 Uploader",
      email: `phase11-media-${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: await hashPassword("Test-Password-123"),
      role: "PUBLISHER",
      emailVerified: true,
    },
  });
  uploaderId = user.id;
  createdUserIds.push(user.id);
});

afterAll(async () => {
  // The uploaded file itself lands under .uploads/ (gitignored) and is left
  // in place — low-volume test hygiene, consistent with how this suite
  // never cleans up incidental filesystem side effects elsewhere either.
  if (createdMediaIds.length > 0) {
    await prisma.mediaAsset.deleteMany({ where: { id: { in: createdMediaIds } } });
  }
  if (createdUserIds.length > 0) {
    await retireTestUsers(createdUserIds);
  }
});

describe("media — §45 rules 25/26: stored outside Postgres, only metadata/references kept", () => {
  it("the stored row is a URL + metadata, never the file's bytes", async () => {
    const media = await mediaService.uploadMedia({ file: fakeFile(), uploadedBy: uploaderId });
    createdMediaIds.push(media.id);

    expect(typeof media.url).toBe("string");
    expect(media.url.length).toBeGreaterThan(0);
    expect(media.storageKey).toBeTruthy();
    // The full field set a media row carries — no binary/blob column exists
    // to check for its absence directly, so this pins the actual shape
    // instead: everything here is a reference or metadata, nothing is content.
    expect(Object.keys(media).sort()).toEqual(
      [
        "id",
        "fileName",
        "storageKey",
        "url",
        "mimeType",
        "fileSize",
        "width",
        "height",
        "uploadedBy",
        "createdAt",
      ].sort(),
    );
  });

  it("probes real image dimensions from the uploaded bytes", async () => {
    const media = await mediaService.uploadMedia({ file: fakeFile(), uploadedBy: uploaderId });
    createdMediaIds.push(media.id);
    expect(media.width).toBe(1);
    expect(media.height).toBe(1);
  });

  it("the storage key is random, not derived from the caller-supplied filename", async () => {
    const media = await mediaService.uploadMedia({
      file: fakeFile({ originalname: "../../etc/passwd.png" }),
      uploadedBy: uploaderId,
    });
    createdMediaIds.push(media.id);
    expect(media.storageKey).not.toContain("passwd");
    expect(media.storageKey).not.toContain("..");
    expect(media.fileName).toBe("../../etc/passwd.png"); // kept as display metadata only
  });

  it("rejects an unsupported file type", async () => {
    await expect(
      mediaService.uploadMedia({
        file: fakeFile({ mimetype: "text/plain", originalname: "notes.txt" }),
        uploadedBy: uploaderId,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
  });

  it("rejects an oversized image before ever touching storage", async () => {
    await expect(
      mediaService.uploadMedia({
        file: fakeFile({ size: 11 * 1024 * 1024 }),
        uploadedBy: uploaderId,
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("accepts a PDF up to its own, larger limit", async () => {
    const media = await mediaService.uploadMedia({
      file: fakeFile({
        mimetype: "application/pdf",
        originalname: "issue.pdf",
        buffer: Buffer.from("%PDF-1.4 fake pdf content for testing"),
        size: 20 * 1024 * 1024, // over the image cap, under the PDF cap
      }),
      uploadedBy: uploaderId,
    });
    createdMediaIds.push(media.id);
    expect(media.mimeType).toBe("application/pdf");
  });
});
