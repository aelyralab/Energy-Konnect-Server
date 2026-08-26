/**
 * Public-facing article shape (IMPLEMENTATION_PLAN.md §3, matching the
 * context doc's §35 response shape). This is the only path a published
 * article's data takes to become JSON — nothing here can leak
 * `pendingVersionId`, draft blocks, or any other non-public field, because
 * those fields are never read out of the Prisma row in the first place.
 */
// Exported — the publisher-facing owner serializer (Phase 6) reuses these
// rather than re-implementing the same taxonomy/media shaping twice.
export function serializeMediaUrl(media) {
  return media?.url ?? null;
}

export function serializeCategory(category) {
  if (!category) return null;
  return { id: category.id, name: category.name, slug: category.slug };
}

export function serializeTopics(articleTopics) {
  return (articleTopics ?? []).map(({ topic }) => ({
    id: topic.id,
    name: topic.name,
    slug: topic.slug,
  }));
}

export function serializeTags(articleTags) {
  return (articleTags ?? []).map(({ tag }) => ({ id: tag.id, name: tag.name, slug: tag.slug }));
}

/** An article belongs to at most one issue in practice; the join is 0..n for
 * schema flexibility, so this takes the first entry if present. */
function serializeIssueContext(issueArticles) {
  const entry = issueArticles?.[0];
  if (!entry?.issue) return null;
  return {
    id: entry.issue.id,
    slug: entry.issue.slug,
    volume: entry.issue.volumeNumber,
    issue: entry.issue.issueNumber,
    period: entry.issue.period,
    section: entry.sectionLabel,
  };
}

function serializeReadingTime(article) {
  const minutes = article.currentPublishedVersion?.readingMinutes;
  return minutes ? `${minutes} min read` : null;
}

/**
 * @param {object} article
 * @param {object} [options]
 * @param {object|null} [options.issueContext] - pre-built issue block, used by
 *   the publications module where the caller already knows the issue/section
 *   from the join it queried through — passing it in avoids the nested article
 *   query needing its own redundant self-join back to `issues`.
 */
export function serializeArticleSummary(article, { issueContext } = {}) {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    subtitle: article.subtitle,
    summary: article.summary,
    author: { name: article.authorName, bio: article.authorBio },
    category: serializeCategory(article.category),
    topics: serializeTopics(article.topics),
    tags: serializeTags(article.tags),
    issue: issueContext !== undefined ? issueContext : serializeIssueContext(article.issues),
    coverImage: serializeMediaUrl(article.cover),
    featured: article.isFeatured,
    readingTime: serializeReadingTime(article),
    publishedAt: article.publishedAt,
  };
}

export function serializeArticleDetail(article) {
  const blocks = article.currentPublishedVersion?.blocks ?? [];
  return {
    ...serializeArticleSummary(article),
    content: blocks.map((block) => ({
      id: block.id,
      type: block.blockType,
      order: block.blockOrder,
      data: block.content,
    })),
  };
}
