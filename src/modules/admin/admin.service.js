/**
 * Admin article workflow (context doc §27, §28, §30, §31, §32;
 * IMPLEMENTATION_PLAN.md Phase 7). Admin acts on any article — no ownership
 * check — but every transition still goes through the same core
 * (articles.service.js / articleVersions.service.js) the publisher workflow
 * uses, so "a version becomes published" only ever happens one way.
 */
import prisma from "../../config/db.js";
import logger from "../../config/logger.js";
import ApiError from "../../utils/ApiError.js";
import * as articlesService from "../articles/articles.service.js";
import * as versionsService from "../articleVersions/articleVersions.service.js";
import * as reviewsRepo from "../reviews/reviews.repository.js";
import * as notificationsService from "../notifications/notifications.service.js";

const TRANSACTION_OPTIONS = { timeout: 10_000 };

async function getArticleOrThrow(id) {
  return articlesService.getByIdWithVersions(id);
}

/**
 * The §27 approval transaction, generalised to cover both "approve a
 * submission" and "publish directly" (§30 rule 11: admin doesn't need a
 * submission at all) — the only difference between them is which review
 * action gets logged and which pending-version statuses are acceptable
 * going in; the promotion itself (status, pointers, publishedAt, snapshot,
 * SUPERSEDED bookkeeping, audit row) is identical either way.
 */
async function promoteToPublished(article, version, actorId, action) {
  const previousPublishedVersionId = article.currentPublishedVersionId;
  // The article's very first publish, ever — as opposed to a revision or an
  // admin edit on something already live. This is the signal for "tell
  // readers about it" (a broadcast) vs. "just update the content" (no
  // broadcast — nobody wants a fresh email every time a typo gets fixed).
  const isFirstPublish = previousPublishedVersionId === null;

  await prisma.$transaction(async (tx) => {
    await versionsService.markPublished(version.id, tx);
    // §27: "published article versions are not destructively overwritten" —
    // the version this one replaces becomes historical record, not deleted
    // and not silently left PUBLISHED (which would make two versions of one
    // article both claim to be live).
    if (previousPublishedVersionId && previousPublishedVersionId !== version.id) {
      await versionsService.markSuperseded(previousPublishedVersionId, tx);
    }
    await articlesService.publishVersion(article.id, version.id, version, tx);
    // The version just promoted may carry a different categoryId than what
    // was live before — search_vector's taxonomy weight has to catch up.
    await articlesService.refreshSearchText(article.id, tx);
    await reviewsRepo.create(
      { articleId: article.id, articleVersionId: version.id, actorId, action },
      tx,
    );

    // Notification fan-out (§39), written in the same transaction as the
    // publish itself — a crash here must not leave a published article with
    // no notification, or notification rows for a publish that never
    // committed. Delivery is the outbox worker's job, not this one's.
    if (isFirstPublish) {
      await notificationsService.notifyArticlePublished(article, tx);
      // Publisher notified only when someone else's article just went live
      // for the first time — not on every later admin edit (editPublished
      // always has isFirstPublish = false already), and never for admin
      // publishing their own work.
      if (article.publisherId !== actorId) {
        await notificationsService.notifyArticleApproved(article, tx);
      }
    }
  }, TRANSACTION_OPTIONS);

  // Deliberately outside the transaction: articlesService.getByIdWithVersions
  // has no way to take `tx`, and reading through the global client from
  // *inside* an interactive transaction would see the pre-commit snapshot,
  // not the writes just made — a real bug this exact shape produced until
  // caught by tests/integration/adminWorkflow.test.js (every promoted
  // article came back showing its old, pre-promotion status).
  return articlesService.getByIdWithVersions(article.id);
}

export function listReviewQueue(query) {
  return articlesService.listReviewQueue(query);
}

export function listArticles(query) {
  return articlesService.listAllForAdmin(query);
}

export function getArticle(id) {
  return getArticleOrThrow(id);
}

/** §30: admin creates like a publisher would, optionally publishing
 * immediately instead of leaving it as a DRAFT. */
export async function createArticle(actorId, payload, { publish }) {
  const article = await articlesService.createArticle({ publisherId: actorId, ...payload });
  if (!publish) return article;

  return promoteToPublished(article, article.pendingVersion, actorId, "PUBLISHED_DIRECT");
}

/** Same mechanics as the publisher's updateDraft — edits whichever version
 * is open for editing — just without an ownership restriction. */
export async function updateArticle(actorId, id, payload) {
  const article = await getArticleOrThrow(id);
  const versionId = article.pendingVersionId;
  if (!versionId) {
    throw ApiError.conflict("This article has no version open for editing", "NO_EDITABLE_VERSION");
  }

  const { topicIds, tagIds, ...versionPayload } = payload;
  const version = await versionsService.saveContent(versionId, versionPayload);
  await articlesService.setTaxonomy(id, { topicIds, tagIds });
  await articlesService.resyncSnapshotIfUnpublished(article, version);
  await articlesService.refreshSearchText(id);

  return getArticleOrThrow(id);
}

export async function approve(actorId, id) {
  const article = await getArticleOrThrow(id);
  const versionId = article.pendingVersionId;
  if (!versionId) {
    throw ApiError.conflict("This article has no version to approve", "NO_PENDING_VERSION");
  }
  const version = await versionsService.getById(versionId);
  if (version.status !== "PENDING_REVIEW") {
    throw ApiError.conflict("Only a submitted version can be approved", "NOT_PENDING_REVIEW");
  }
  return promoteToPublished(article, version, actorId, "APPROVED");
}

export async function reject(actorId, id, reason) {
  const article = await getArticleOrThrow(id);
  const versionId = article.pendingVersionId;
  if (!versionId) {
    throw ApiError.conflict("This article has no version to reject", "NO_PENDING_VERSION");
  }
  const version = await versionsService.getById(versionId);
  if (version.status !== "PENDING_REVIEW") {
    throw ApiError.conflict("Only a submitted version can be rejected", "NOT_PENDING_REVIEW");
  }

  await prisma.$transaction(async (tx) => {
    await versionsService.markRejected(versionId, tx);
    // A revision-in-progress rejection leaves the article exactly as public
    // as it was — only ever the never-published case flips the article itself.
    if (article.currentPublishedVersionId === null) {
      await articlesService.setStatus(id, "REJECTED", tx);
    }
    await reviewsRepo.create(
      { articleId: id, articleVersionId: versionId, actorId, action: "REJECTED", reason },
      tx,
    );
    await notificationsService.notifyArticleRejected(article, reason, tx);
  }, TRANSACTION_OPTIONS);

  return getArticleOrThrow(id);
}

/** §30/rule 11: admin can publish the pending version directly, regardless
 * of whether a publisher ever submitted it for review. */
export async function publishDirect(actorId, id) {
  const article = await getArticleOrThrow(id);
  const versionId = article.pendingVersionId;
  if (!versionId) {
    throw ApiError.conflict("This article has no version to publish", "NO_PENDING_VERSION");
  }
  const version = await versionsService.getById(versionId);
  return promoteToPublished(article, version, actorId, "PUBLISHED_DIRECT");
}

/**
 * §31: admin editing an already-published article. Creates a fresh version
 * from the submitted payload — not a copy the admin then edits, since this
 * *is* the edit — and publishes it in the same step, no review ceremony.
 * Refused while a publisher's (or an earlier) revision is already pending,
 * so this can never silently orphan someone else's in-progress work — use
 * approve/reject/publish on that pending version instead.
 */
export async function editPublished(actorId, id, payload) {
  const article = await getArticleOrThrow(id);
  if (article.currentPublishedVersionId === null) {
    throw ApiError.conflict(
      "This article has never been published — use the regular update endpoint",
      "NOT_PUBLISHED",
    );
  }
  if (article.pendingVersionId !== null) {
    throw ApiError.conflict(
      "A revision is already pending for this article — approve, reject, or publish it instead",
      "REVISION_IN_PROGRESS",
    );
  }

  const { topicIds, tagIds, ...versionPayload } = payload;
  const newVersion = await versionsService.createNextVersion(id, versionPayload, actorId);
  await articlesService.setTaxonomy(id, { topicIds, tagIds });

  return promoteToPublished(article, newVersion, actorId, "PUBLISHED_DIRECT");
}

export async function unpublish(actorId, id) {
  const article = await getArticleOrThrow(id);
  if (article.status !== "PUBLISHED") {
    throw ApiError.conflict("Only a published article can be unpublished", "NOT_PUBLISHED");
  }
  await articlesService.setStatus(id, "UNPUBLISHED");
  await reviewsRepo.create({ articleId: id, actorId, action: "UNPUBLISHED" });
  return getArticleOrThrow(id);
}

export async function archive(actorId, id) {
  const article = await getArticleOrThrow(id);
  if (!["PUBLISHED", "UNPUBLISHED"].includes(article.status)) {
    throw ApiError.conflict(
      "Only a published or unpublished article can be archived",
      "NOT_ARCHIVABLE",
    );
  }
  await articlesService.setStatus(id, "ARCHIVED");
  await reviewsRepo.create({ articleId: id, actorId, action: "ARCHIVED" });
  return getArticleOrThrow(id);
}

/**
 * Hard delete, any status (unlike publisher removeDraft, which is
 * never-published drafts only). Cascades take out versions, comments,
 * review actions, issue placements, notifications and guest reads — see
 * schema.prisma. No ArticleReviewAction row is written: it would cascade
 * away with the article it describes, so the record goes to the log instead.
 */
export async function remove(actorId, id) {
  const article = await getArticleOrThrow(id); // 404s on unknown id
  await articlesService.remove(id);
  logger.warn(
    { actorId, articleId: id, slug: article.slug, title: article.title, status: article.status },
    "admin hard-deleted an article",
  );
}

export async function listVersions(id) {
  await getArticleOrThrow(id); // 404 if the article itself doesn't exist
  return versionsService.listByArticleId(id);
}

export async function getVersion(id, versionId) {
  const version = await versionsService.getById(versionId);
  if (version.articleId !== id) {
    throw ApiError.notFound("Article version not found");
  }
  return version;
}

export async function history(id) {
  await getArticleOrThrow(id);
  return reviewsRepo.findByArticleId(id);
}
