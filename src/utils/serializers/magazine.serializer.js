import { serializeArticleSummary } from "./article.serializer.js";

function serializeMediaUrl(media) {
  return media?.url ?? null;
}

export function serializeMagazineSummary(magazine) {
  return {
    id: magazine.id,
    slug: magazine.slug,
    title: magazine.title,
    volume: magazine.volumeNumber,
    issue: magazine.issueNumber,
    period: magazine.period,
    theme: magazine.theme,
    description: magazine.description,
    coverImage: serializeMediaUrl(magazine.cover),
    publishedAt: magazine.publishedAt,
  };
}

/**
 * Magazine status and article status are independent (context doc §21, rule
 * 18) — a published magazine's article list must still hide any article
 * that is itself not PUBLISHED, so that filter happens here rather than
 * trusting the join to have only ever linked published articles.
 */
export function serializeMagazineDetail(magazine) {
  const contents = (magazine.articles ?? [])
    .filter((entry) => entry.article.status === "PUBLISHED")
    .map((entry) => ({
      section: entry.sectionLabel,
      displayOrder: entry.displayOrder,
      article: serializeArticleSummary(entry.article, {
        magazineContext: {
          id: magazine.id,
          slug: magazine.slug,
          volume: magazine.volumeNumber,
          issue: magazine.issueNumber,
          period: magazine.period,
          section: entry.sectionLabel,
        },
      }),
    }));

  return {
    ...serializeMagazineSummary(magazine),
    pdfUrl: magazine.pdf?.url ?? null,
    contents,
    editorial: magazine.editorialBody
      ? {
          title: magazine.editorialTitle,
          author: magazine.editorialAuthor,
          summary: magazine.editorialSummary,
          body: magazine.editorialBody.map((block, index) => ({
            id: String(index),
            order: index,
            type: block.blockType,
            data: block.content,
          })),
        }
      : null,
  };
}
