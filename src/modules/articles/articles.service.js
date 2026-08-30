import prisma from "../../config/db.js";
import ApiError from "../../utils/ApiError.js";
import { attachVersionMediaUrls } from "../../utils/blockMedia.js";
import { uniqueSlug } from "../../utils/slug.js";
import * as repo from "./articles.repository.js";
import * as versionsService from "../articleVersions/articleVersions.service.js";

// Neon's serverless compute can cold-start on the first query after a period
// of inactivity (config/db.js) — the default 5s transaction timeout has cut
// it close in practice, so this multi-step transaction gets a little more room.
const TRANSACTION_OPTIONS = { timeout: 10_000 };

export async function listPublished(query) {
  const { items, total } = await repo.findPublishedList(query);
  return { items, total, page: query.page, limit: query.limit };
}

export async function getPublishedBySlug(slug) {
  const article = await repo.findPublishedBySlug(slug);
  if (!article) throw ApiError.notFound("Article not found");
  return withResolvedBlockMedia(article);
}

/** Blocks carry only a mediaId; readers need the URL. See utils/blockMedia.js. */
async function withResolvedBlockMedia(article) {
  const version = article.currentPublishedVersion;
  if (!version?.blocks?.length) return article;
  return {
    ...article,
    currentPublishedVersion: await attachVersionMediaUrls(version),
  };
}

/** Used by the comments module: a comment may only target a published
 * article (context doc — comments are reader engagement with live content). */
export async function isPublished(articleId) {
  const article = await repo.findPublishedById(articleId);
  return article !== null;
}

/**
 * The reusable "article core" both the publisher and admin create-article
 * endpoints (Phases 6–7) call into: a brand-new Article shell plus its first
 * Version and blocks, committed as one transaction. `pendingVersionId` is set
 * here — not left null — because it consistently marks "the version currently
 * being worked toward publication," whether that's version 1 of a new
 * article or version N+1 of a revision (see articleVersions.service.js and
 * IMPLEMENTATION_PLAN.md §29 for the revision case built in Phase 6).
 *
 * The slug is generated once here, from the initial title, and never changes
 * on its own afterward — including before first publish — matching the
 * frozen-slug rule already applied to categories/topics/tags
 * (IMPLEMENTATION_PLAN.md §0.2.3).
 */
export async function createArticle({ publisherId, topicIds, tagIds, ...versionPayload }) {
  const { blocks: _blocks, ...snapshot } = versionPayload;
  const slug = await uniqueSlug(versionPayload.title, repo.slugExists);

  return prisma.$transaction(async (tx) => {
    const article = await repo.create({ slug, publisherId, ...snapshot }, tx);
    const version = await versionsService.createFirstVersion(
      article.id,
      versionPayload,
      publisherId,
      tx,
    );
    await repo.setPendingVersion(article.id, version.id, tx);
    await repo.setTaxonomy(article.id, { topicIds, tagIds }, tx);
    await refreshSearchText(article.id, tx);

    // Re-read through the same include the owner-detail endpoints use,
    // rather than hand-assembling the shape — one source of truth for what
    // "the full owner view of an article" looks like.
    return repo.findByIdWithVersions(article.id, tx);
  }, TRANSACTION_OPTIONS);
}

/** Unfiltered by status — for the publisher/admin write-side, not public reads. */
export async function getById(id) {
  const article = await repo.findById(id);
  if (!article) throw ApiError.notFound("Article not found");
  return article;
}

/** Full detail (both versions, taxonomy) — for the owning publisher/admin. */
export async function getByIdWithVersions(id) {
  const article = await repo.findByIdWithVersions(id);
  if (!article) throw ApiError.notFound("Article not found");
  return {
    ...article,
    pendingVersion: await attachVersionMediaUrls(article.pendingVersion),
    currentPublishedVersion: await attachVersionMediaUrls(article.currentPublishedVersion),
  };
}

export async function listOwnedByPublisher(query) {
  const { items, total } = await repo.findOwnByPublisher(query);
  return { items, total, page: query.page, limit: query.limit };
}

export function setTaxonomy(articleId, taxonomy, db) {
  return repo.setTaxonomy(articleId, taxonomy, db);
}

/**
 * Recomputes and writes search_vector's taxonomy weight (C) — the one piece
 * of full-text search this codebase has to actively maintain, since
 * title/subtitle/summary/authorName (weights A/B/D) read straight off
 * Article's own columns and category/topic/tag names live in joined tables
 * a generated column can't reach (§42; Phase 10).
 *
 * Called after anything that can change the category or the topic/tag
 * associations: createArticle, publisher/admin updateDraft, and
 * promoteToPublished (where an approval copies the version's categoryId
 * onto Article). Cheap and safe to call even when nothing relevant changed
 * — it's an idempotent recompute, not an incremental patch.
 */
export async function refreshSearchText(articleId, db) {
  const taxonomy = await repo.findTaxonomyNames(articleId, db);
  if (!taxonomy) return; // article no longer exists — nothing to refresh
  const searchText = [taxonomy.categoryName, ...taxonomy.topicNames, ...taxonomy.tagNames]
    .filter(Boolean)
    .join(" ");
  await repo.updateSearchText(articleId, searchText, db);
}

/** The subset of a version's fields that make sense copied onto the Article
 * row's denormalized snapshot — explicit allow-list, not a raw spread, so a
 * version-only field (status, versionNumber, blocks, ...) can never leak
 * onto Article by accident. */
function snapshotFieldsOf(version) {
  return {
    title: version.title,
    subtitle: version.subtitle,
    summary: version.summary,
    authorName: version.authorName,
    authorBio: version.authorBio,
    categoryId: version.categoryId,
    coverMediaId: version.coverMediaId,
    contentMode: version.contentMode,
    pdfMediaId: version.pdfMediaId,
    pdfPageCount: version.pdfPageCount,
  };
}

/**
 * Syncs the Article row's denormalized snapshot from `version`'s metadata —
 * safe ONLY when there is no separate published state to protect (a
 * from-scratch draft, `currentPublishedVersionId === null`). See
 * articles.repository.js `create()` for why this can't just always run.
 */
export function resyncSnapshotIfUnpublished(article, version, db) {
  if (article.currentPublishedVersionId !== null) return null;
  return repo.updateSnapshot(article.id, snapshotFieldsOf(version), db);
}

export function setStatus(id, status, db) {
  return repo.setStatus(id, status, db);
}

export function setPendingVersion(id, versionId, db) {
  return repo.setPendingVersion(id, versionId, db);
}

export function remove(id, db) {
  return repo.remove(id, db);
}

// --- Admin-only ---------------------------------------------------------

export async function listReviewQueue(query) {
  const { items, total } = await repo.findReviewQueue(query);
  return { items, total, page: query.page, limit: query.limit };
}

export async function listAllForAdmin(query) {
  const { items, total } = await repo.findAllForAdmin(query);
  return { items, total, page: query.page, limit: query.limit };
}

/** The approve/direct-publish write: status, pointers, publishedAt, and the
 * snapshot all move together — always safe here, unlike
 * resyncSnapshotIfUnpublished, since `version` becoming
 * currentPublishedVersion is exactly what makes it the public truth. */
export function publishVersion(id, versionId, version, db) {
  return repo.markPublished(id, versionId, snapshotFieldsOf(version), db);
}
