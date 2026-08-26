-- Full-text search support for articles.
--
-- Prisma has no tsvector type, so this column and its index are hand-written
-- rather than expressed in schema.prisma. `search_text` is a plain column the
-- article service rebuilds on every write from title + subtitle + summary +
-- author name + category name + topic names + tag names (context doc §42).
-- `search_vector` derives from it automatically — nothing ever writes to
-- search_vector directly, so it cannot drift out of sync with search_text.

ALTER TABLE "articles"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("search_text", ''))) STORED;

CREATE INDEX "articles_search_vector_idx" ON "articles" USING GIN ("search_vector");
