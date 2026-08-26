/**
 * PostgreSQL full-text search (context doc §42; IMPLEMENTATION_PLAN.md Phase
 * 10). Two queries, not a join with the full article shape baked in:
 *   1. this raw query — ranked, filtered ids + a snippet, weighted search
 *      (title A / subtitle+summary B / taxonomy C / author D, via the
 *      generated search_vector column — see the 20260822140000 migration).
 *   2. a normal Prisma findMany for the matched ids' full relational data,
 *      reusing the exact include shape articles.repository.js's public list
 *      uses, so search results serialize through the same
 *      serializeArticleSummary as every other public article list.
 * Splitting it this way keeps the hand-written SQL surface to just the part
 * Prisma genuinely can't express (tsvector ranking) — the same principle
 * behind the search_vector migration and the notification outbox's
 * claimBatch.
 */
import { Prisma } from "@prisma/client";
import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

const LIST_INCLUDE = {
  category: true,
  cover: true,
  topics: { include: { topic: true } },
  tags: { include: { tag: true } },
  issues: {
    include: {
      issue: {
        select: { id: true, slug: true, volumeNumber: true, issueNumber: true, period: true },
      },
    },
  },
  currentPublishedVersion: { select: { readingMinutes: true } },
};

// ts_headline snippet source is summary/subtitle only, matching §42's search
// field list — full article body text is deliberately not in that list (it
// lives in a separate JSONB-per-block table, not a column search_vector or
// ts_headline can reach without a much heavier query).
export async function search({ q, category, topic, tag, page, limit }) {
  const { skip, take } = toSkipTake({ page, limit });

  const filters = [
    Prisma.sql`a.status = 'PUBLISHED'`,
    Prisma.sql`a.search_vector @@ websearch_to_tsquery('english', ${q})`,
  ];
  if (category) {
    filters.push(
      Prisma.sql`EXISTS (SELECT 1 FROM categories c WHERE c.id = a.category_id AND c.slug = ${category})`,
    );
  }
  if (topic) {
    filters.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM article_topics jt
        JOIN topics t ON t.id = jt.topic_id
        WHERE jt.article_id = a.id AND t.slug = ${topic}
      )`,
    );
  }
  if (tag) {
    filters.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM article_tags jg
        JOIN tags tg ON tg.id = jg.tag_id
        WHERE jg.article_id = a.id AND tg.slug = ${tag}
      )`,
    );
  }

  const rows = await prisma.$queryRaw`
    SELECT
      a.id,
      ts_rank(a.search_vector, websearch_to_tsquery('english', ${q})) AS rank,
      ts_headline(
        'english',
        coalesce(a.summary, a.subtitle, ''),
        websearch_to_tsquery('english', ${q}),
        'MaxWords=40, MinWords=15, ShortWord=3, HighlightAll=false'
      ) AS snippet,
      count(*) OVER() AS total_count
    FROM articles a
    WHERE ${Prisma.join(filters, " AND ")}
    ORDER BY rank DESC, a.published_at DESC
    LIMIT ${take} OFFSET ${skip}
  `;

  if (rows.length === 0) return { items: [], total: 0 };

  // BIGINT from count(*) OVER() arrives as a JS BigInt — doesn't survive
  // JSON.stringify, has to become a plain number before it leaves here.
  const total = Number(rows[0].total_count);

  const articles = await prisma.article.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    include: LIST_INCLUDE,
  });
  const articleById = new Map(articles.map((article) => [article.id, article]));

  // Reassembled in the raw query's rank order — findMany with
  // `id: { in: [...] }` doesn't preserve the array's order.
  const items = rows
    .map((row) => {
      const article = articleById.get(row.id);
      return article ? { ...article, snippet: row.snippet } : null;
    })
    .filter(Boolean);

  return { items, total };
}
