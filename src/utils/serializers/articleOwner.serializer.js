/**
 * The publisher/admin-facing article shape — deliberately separate from
 * article.serializer.js's public one, since this exposes fields (status,
 * both versions, block content of unpublished drafts) the public serializer
 * must never leak.
 */
import {
  serializeCategory,
  serializeTopics,
  serializeTags,
  serializeMediaUrl,
} from "./article.serializer.js";

function serializeVersion(version) {
  if (!version) return null;
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    title: version.title,
    subtitle: version.subtitle,
    summary: version.summary,
    author: { name: version.authorName, bio: version.authorBio },
    categoryId: version.categoryId,
    coverMediaId: version.coverMediaId,
    readingTime: version.readingMinutes ? `${version.readingMinutes} min read` : null,
    blocks: (version.blocks ?? []).map((block) => ({
      id: block.id,
      type: block.blockType,
      order: block.blockOrder,
      data: block.content,
    })),
    createdAt: version.createdAt,
    submittedAt: version.submittedAt,
    approvedAt: version.approvedAt,
    rejectedAt: version.rejectedAt,
  };
}

export function serializeOwnerArticleSummary(article) {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    status: article.status,
    category: serializeCategory(article.category),
    coverImage: serializeMediaUrl(article.cover),
    isPublished: article.currentPublishedVersionId !== null,
    hasPendingRevision:
      article.pendingVersionId !== null && article.currentPublishedVersionId !== null,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}

/**
 * `pendingVersion`: the version currently open for editing, if any — a
 * from-scratch draft or a revision-in-progress. `publishedVersion`: the live
 * public content, for reference. An article can have either, both, or (very
 * briefly, mid-creation) only the former.
 */
export function serializeOwnerArticleDetail(article) {
  return {
    ...serializeOwnerArticleSummary(article),
    topics: serializeTopics(article.topics),
    tags: serializeTags(article.tags),
    pendingVersion: serializeVersion(article.pendingVersion),
    publishedVersion: serializeVersion(article.currentPublishedVersion),
  };
}
