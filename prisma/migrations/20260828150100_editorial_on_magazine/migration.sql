-- Editorials become a first-class part of the magazine instead of a fake
-- Article. Adds the editorial_* columns, copies every existing
-- sectionLabel='Editorial' article's content into its magazine, then
-- deletes those Article rows (cascades: their versions, content blocks,
-- the magazine_articles join row, and any comments/guest_reads/
-- notifications — verified against the source database as zero comments
-- and a small handful of publish notifications for the one editorial that
-- was ever published).
--
-- Handles zero editorials gracefully (a fresh/seeded database has none).

ALTER TABLE "magazines" ADD COLUMN "editorial_title" VARCHAR(300);
ALTER TABLE "magazines" ADD COLUMN "editorial_author" VARCHAR(200);
ALTER TABLE "magazines" ADD COLUMN "editorial_summary" TEXT;
ALTER TABLE "magazines" ADD COLUMN "editorial_body" JSONB;

DO $$
DECLARE
  editorial_count integer;
  updated_count integer;
BEGIN
  SELECT count(*) INTO editorial_count
  FROM "magazine_articles"
  WHERE "section_label" ILIKE 'editorial';

  WITH editorial_content AS (
    SELECT
      ma."magazine_id" AS magazine_id,
      v."title" AS title,
      v."author_name" AS author_name,
      v."summary" AS summary,
      (
        SELECT jsonb_agg(
                 jsonb_build_object('blockType', cb."block_type", 'content', cb."content")
                 ORDER BY cb."block_order"
               )
        FROM "article_content_blocks" cb
        WHERE cb."article_version_id" = v."id"
      ) AS blocks
    FROM "magazine_articles" ma
    JOIN "articles" a ON a."id" = ma."article_id"
    JOIN "article_versions" v ON v."id" = COALESCE(a."pending_version_id", a."current_published_version_id")
    WHERE ma."section_label" ILIKE 'editorial'
  )
  UPDATE "magazines" m
  SET "editorial_title" = ec.title,
      "editorial_author" = ec.author_name,
      "editorial_summary" = ec.summary,
      "editorial_body" = COALESCE(ec.blocks, '[]'::jsonb)
  FROM editorial_content ec
  WHERE m."id" = ec.magazine_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count <> editorial_count THEN
    RAISE EXCEPTION 'Editorial migration mismatch: % editorial join rows, % magazines updated', editorial_count, updated_count;
  END IF;

  DELETE FROM "articles" a
  USING "magazine_articles" ma
  WHERE ma."article_id" = a."id"
    AND ma."section_label" ILIKE 'editorial';
END $$;
