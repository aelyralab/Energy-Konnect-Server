-- Reweights full-text search (context doc §42; IMPLEMENTATION_PLAN.md Phase
-- 10: "title A, subtitle/summary B, taxonomy C, author D").
--
-- The original search_vector (20260821120100) derived from one flat
-- search_text column holding everything concatenated with no weighting.
-- title/subtitle/summary/author_name are already real columns on Article —
-- the denormalized public snapshot every other write path already keeps
-- current — so there is no need to duplicate them into search_text at all.
-- Only the "taxonomy" component (category name + topic names + tag names)
-- has no dedicated column, since it comes from joined tables Postgres
-- generated columns cannot reach into; search_text is repurposed to hold
-- just that piece from here on (see articles.service.js#refreshSearchText).
--
-- A generated column's expression can't be altered in place — drop and
-- recreate it, same as the index that follows it.

DROP INDEX IF EXISTS "articles_search_vector_idx";
ALTER TABLE "articles" DROP COLUMN "search_vector";

ALTER TABLE "articles"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(
      to_tsvector('english', coalesce("subtitle", '') || ' ' || coalesce("summary", '')),
      'B'
    ) ||
    setweight(to_tsvector('english', coalesce("search_text", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("author_name", '')), 'D')
  ) STORED;

CREATE INDEX "articles_search_vector_idx" ON "articles" USING GIN ("search_vector");
