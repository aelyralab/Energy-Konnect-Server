import { serializeArticleSummary } from "./article.serializer.js";

function serializeMediaUrl(media) {
  return media?.url ?? null;
}

export function serializeIssueSummary(issue) {
  return {
    id: issue.id,
    slug: issue.slug,
    title: issue.title,
    volume: issue.volumeNumber,
    issue: issue.issueNumber,
    period: issue.period,
    theme: issue.theme,
    description: issue.description,
    coverImage: serializeMediaUrl(issue.cover),
    publishedAt: issue.publishedAt,
  };
}

/**
 * Issue status and article status are independent (context doc §21, rule 18)
 * — a published issue's article list must still hide any article that is
 * itself not PUBLISHED, so that filter happens here rather than trusting the
 * join to have only ever linked published articles.
 */
export function serializeIssueDetail(issue) {
  const contents = (issue.articles ?? [])
    .filter((entry) => entry.article.status === "PUBLISHED")
    .map((entry) => ({
      section: entry.sectionLabel,
      displayOrder: entry.displayOrder,
      article: serializeArticleSummary(entry.article, {
        issueContext: {
          id: issue.id,
          slug: issue.slug,
          volume: issue.volumeNumber,
          issue: issue.issueNumber,
          period: issue.period,
          section: entry.sectionLabel,
        },
      }),
    }));

  return {
    ...serializeIssueSummary(issue),
    pdfUrl: issue.pdf?.url ?? null,
    contents,
  };
}
