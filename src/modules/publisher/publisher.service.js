/**
 * Publisher workflow (context doc §26, §29; IMPLEMENTATION_PLAN.md Phase 6).
 * Every function here takes `publisherId` first and checks it against the
 * article before doing anything else — ownership is enforced in the
 * service, on every mutation, never in the route (§37/§45 rule 29).
 */
import ApiError from "../../utils/ApiError.js";
import * as articlesService from "../articles/articles.service.js";
import * as versionsService from "../articleVersions/articleVersions.service.js";
import * as reviewsRepo from "../reviews/reviews.repository.js";

/**
 * Deliberately ApiError.notFound, not forbidden: a 403 would confirm the
 * article exists and belongs to someone else, which is itself a leak. This
 * is the exact behavior Phase 6's "done when" bar checks — publisher B gets
 * 404 on publisher A's article at every one of these endpoints.
 */
async function getOwnedOrThrow(publisherId, id) {
  const article = await articlesService.getByIdWithVersions(id);
  if (article.publisherId !== publisherId) {
    throw ApiError.notFound("Article not found");
  }
  return article;
}

/** §26: what must be true of the *saved* content before submitting for
 * review. Block shapes were already validated at save time
 * (blockSchemas.js) — this only checks presence of the fields the doc names,
 * plus "at least one block". */
function assertSubmitReady(version) {
  const missing = [];
  if (!version.title?.trim()) missing.push("title");
  if (!version.summary?.trim()) missing.push("summary");
  if (!version.authorName?.trim()) missing.push("authorName");
  if (!version.categoryId) missing.push("categoryId");
  if (!version.blocks || version.blocks.length === 0) missing.push("blocks");

  if (missing.length > 0) {
    throw ApiError.unprocessable(
      "This article isn't ready to submit — some required fields are missing",
      missing.map((field) => ({ field, message: "Required before submitting for review" })),
      "SUBMIT_REQUIREMENTS_NOT_MET",
    );
  }
}

export function listOwn(publisherId, query) {
  return articlesService.listOwnedByPublisher({ publisherId, ...query });
}

export function getOwn(publisherId, id) {
  return getOwnedOrThrow(publisherId, id);
}

export function createDraft(publisherId, payload) {
  return articlesService.createArticle({ publisherId, ...payload });
}

/** Edits whichever version is currently open for editing — a from-scratch
 * draft, or a revision-in-progress created by revise(). Both are always
 * `article.pendingVersionId`. */
export async function updateDraft(publisherId, id, payload) {
  const article = await getOwnedOrThrow(publisherId, id);
  const versionId = article.pendingVersionId;
  if (!versionId) {
    throw ApiError.conflict(
      "This article has no version open for editing — call revise first",
      "NO_EDITABLE_VERSION",
    );
  }

  const { topicIds, tagIds, ...versionPayload } = payload;
  const version = await versionsService.saveContent(versionId, versionPayload);
  await articlesService.setTaxonomy(id, { topicIds, tagIds });
  await articlesService.resyncSnapshotIfUnpublished(article, version);
  await articlesService.refreshSearchText(id);

  return getOwnedOrThrow(publisherId, id);
}

/** DRAFT|REJECTED → PENDING_REVIEW. A brand-new article's own status follows
 * suit; a revision on an already-published article does not — the article
 * stays PUBLISHED throughout, only the pending version's status changes
 * (§21's status-independence principle, extended to revisions). */
export async function submit(publisherId, id) {
  const article = await getOwnedOrThrow(publisherId, id);
  const versionId = article.pendingVersionId;
  if (!versionId) {
    throw ApiError.conflict("This article has no version to submit", "NO_EDITABLE_VERSION");
  }

  const version = await versionsService.getById(versionId);
  if (!["DRAFT", "REJECTED"].includes(version.status)) {
    throw ApiError.conflict(
      `This version is already ${version.status.toLowerCase().replace("_", " ")} — nothing to submit`,
      "ALREADY_SUBMITTED",
    );
  }
  assertSubmitReady(version);

  await versionsService.markPendingReview(versionId);
  if (article.currentPublishedVersionId === null) {
    await articlesService.setStatus(id, "PENDING_REVIEW");
  }
  await reviewsRepo.create({
    articleId: id,
    articleVersionId: versionId,
    actorId: publisherId,
    action: "SUBMITTED",
  });

  return getOwnedOrThrow(publisherId, id);
}

/** PENDING_REVIEW → DRAFT: pull a submission back before it's been reviewed. */
export async function withdraw(publisherId, id) {
  const article = await getOwnedOrThrow(publisherId, id);
  const versionId = article.pendingVersionId;
  if (!versionId) {
    throw ApiError.conflict("This article has no version to withdraw", "NO_EDITABLE_VERSION");
  }

  const version = await versionsService.getById(versionId);
  if (version.status !== "PENDING_REVIEW") {
    throw ApiError.conflict(
      "Only a version currently under review can be withdrawn",
      "NOT_PENDING_REVIEW",
    );
  }

  await versionsService.markDraft(versionId);
  if (article.currentPublishedVersionId === null) {
    await articlesService.setStatus(id, "DRAFT");
  }
  await reviewsRepo.create({
    articleId: id,
    articleVersionId: versionId,
    actorId: publisherId,
    action: "WITHDRAWN",
  });

  return getOwnedOrThrow(publisherId, id);
}

/**
 * §29: PUBLISHED → a new DRAFT version copied from the current published
 * one, referenced by pendingVersionId. currentPublishedVersionId is
 * untouched — the public article keeps serving the old version in full
 * until this new one is submitted and approved.
 */
export async function revise(publisherId, id) {
  const article = await getOwnedOrThrow(publisherId, id);
  if (article.currentPublishedVersionId === null) {
    throw ApiError.conflict("Only a published article can be revised", "NOT_PUBLISHED");
  }
  if (article.pendingVersionId !== null) {
    throw ApiError.conflict(
      "A revision is already in progress for this article",
      "REVISION_IN_PROGRESS",
    );
  }

  const newVersion = await versionsService.createRevisionFrom(
    article.currentPublishedVersionId,
    id,
    publisherId,
  );
  await articlesService.setPendingVersion(id, newVersion.id);

  return getOwnedOrThrow(publisherId, id);
}

/** Only a draft that has never been published can be deleted outright
 * (IMPLEMENTATION_PLAN.md §0.2.7) — anything else goes through
 * unpublish/archive (Phase 7, admin-only). */
export async function removeDraft(publisherId, id) {
  const article = await getOwnedOrThrow(publisherId, id);
  if (article.status !== "DRAFT" || article.currentPublishedVersionId !== null) {
    throw ApiError.conflict(
      "Only a draft that has never been published can be deleted",
      "ARTICLE_NOT_DELETABLE",
    );
  }
  await articlesService.remove(id);
}

export async function history(publisherId, id) {
  await getOwnedOrThrow(publisherId, id);
  return reviewsRepo.findByArticleId(id);
}
