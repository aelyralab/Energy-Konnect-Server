/**
 * Version + block business logic. Role/ownership checks and status-transition
 * workflow (submit, approve, reject, revise) belong to the publisher/admin
 * services in Phases 6–7 — this file only enforces the structural invariant
 * that applies no matter who's calling: a PUBLISHED or SUPERSEDED version is
 * historical record and cannot be mutated in place (context doc §27, "do not
 * overwrite published content").
 */
import prisma from "../../config/db.js";
import ApiError from "../../utils/ApiError.js";
import { estimateReadingMinutes } from "../../utils/readingTime.js";
import * as repo from "./articleVersions.repository.js";

// PENDING_REVIEW is deliberately excluded: once submitted, a version is
// frozen while an admin is (or may be) looking at it — editing it out from
// under a review in progress is exactly the race this avoids. A publisher
// who wants to change a submitted version calls withdraw() first, which
// drops it back to DRAFT and re-opens it for editing.
const EDITABLE_STATUSES = new Set(["DRAFT", "REJECTED"]);
// See articles.service.js — same Neon cold-start rationale.
const TRANSACTION_OPTIONS = { timeout: 10_000 };

function assertEditable(version) {
  if (!EDITABLE_STATUSES.has(version.status)) {
    throw ApiError.conflict(
      `A ${version.status.toLowerCase().replace("_", " ")} version cannot be edited`,
      "VERSION_NOT_EDITABLE",
    );
  }
}

async function createVersion(articleId, versionNumber, payload, createdBy, db) {
  const { blocks, ...metadata } = payload;
  const readingMinutes = estimateReadingMinutes(blocks);

  const version = await repo.create(
    { articleId, versionNumber, createdBy, status: "DRAFT", readingMinutes, ...metadata },
    db,
  );
  await repo.replaceBlocks(version.id, blocks, db);
  return repo.findById(version.id, db);
}

/**
 * Creates version 1 of a brand-new article, inside the caller's transaction
 * (`db`) so it commits atomically with the Article row that owns it.
 */
export function createFirstVersion(articleId, payload, createdBy, db) {
  return createVersion(articleId, 1, payload, createdBy, db);
}

/**
 * Creates the next version directly from a submitted payload (not a copy of
 * an existing version) — what an admin editing a published article submits
 * (§31): fresh content, immediately promoted to published by the caller,
 * rather than a copy the publisher then edits toward resubmission
 * (createRevisionFrom, below).
 */
export async function createNextVersion(articleId, payload, createdBy, db = prisma) {
  const nextVersionNumber = (await repo.countByArticleId(articleId, db)) + 1;
  return createVersion(articleId, nextVersionNumber, payload, createdBy, db);
}

export async function getById(id) {
  const version = await repo.findById(id);
  if (!version) throw ApiError.notFound("Article version not found");
  return version;
}

export function listByArticleId(articleId) {
  return repo.findAllByArticleId(articleId);
}

/**
 * Deep-copies `sourceVersion` (expected to be the article's current
 * published version) into a brand-new DRAFT version — the §29 mechanism:
 * "Version 2 starts as a copy of Version 1." The copy is metadata *and*
 * blocks; the source itself is never touched, so the public article keeps
 * serving it unchanged while the copy is edited toward resubmission.
 */
export async function createRevisionFrom(sourceVersionId, articleId, createdBy, db = prisma) {
  const source = await repo.findById(sourceVersionId, db);
  if (!source) throw ApiError.notFound("Source version not found");

  const nextVersionNumber = (await repo.countByArticleId(articleId, db)) + 1;
  const version = await repo.create(
    {
      articleId,
      versionNumber: nextVersionNumber,
      createdBy,
      status: "DRAFT",
      title: source.title,
      subtitle: source.subtitle,
      summary: source.summary,
      authorName: source.authorName,
      authorBio: source.authorBio,
      categoryId: source.categoryId,
      coverMediaId: source.coverMediaId,
      readingMinutes: source.readingMinutes,
    },
    db,
  );

  const blocksInput = source.blocks.map((block) => ({
    blockType: block.blockType,
    content: block.content,
  }));
  await repo.replaceBlocks(version.id, blocksInput, db);

  return repo.findById(version.id, db);
}

/** Full metadata + blocks replace — what an editor "Save" submits. */
export async function saveContent(versionId, payload) {
  const version = await repo.findById(versionId);
  if (!version) throw ApiError.notFound("Article version not found");
  assertEditable(version);

  const { blocks, ...metadata } = payload;
  const readingMinutes = estimateReadingMinutes(blocks);

  return prisma.$transaction(async (tx) => {
    await repo.updateMetadata(versionId, { ...metadata, readingMinutes }, tx);
    await repo.replaceBlocks(versionId, blocks, tx);
    return repo.findById(versionId, tx);
  }, TRANSACTION_OPTIONS);
}

// --- Status transitions -----------------------------------------------------
// Kept here rather than let the publisher/admin services reach into this
// module's repository directly — articleVersions stays the one place that
// knows how a version's status actually changes.

export function markPendingReview(versionId, db = prisma) {
  return repo.updateStatus(versionId, "PENDING_REVIEW", "submittedAt", db);
}

/** Submitted → back to DRAFT (withdraw), re-opening it for editing. */
export function markDraft(versionId, db = prisma) {
  return repo.updateStatus(versionId, "DRAFT", null, db);
}

export function markPublished(versionId, db = prisma) {
  return repo.updateStatus(versionId, "PUBLISHED", "approvedAt", db);
}

/** The version this one replaces, on approval — historical record, per §27
 * "published article versions are not destructively overwritten". */
export function markSuperseded(versionId, db = prisma) {
  return repo.updateStatus(versionId, "SUPERSEDED", null, db);
}

export function markRejected(versionId, db = prisma) {
  return repo.updateStatus(versionId, "REJECTED", "rejectedAt", db);
}
