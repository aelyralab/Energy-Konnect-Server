-- Rename "publication issue" -> "magazine" throughout the schema.
-- Metadata-only: no rows move. Written by hand (not `prisma migrate dev`)
-- because a diff-based migration would drop and recreate these tables.

-- Tables
ALTER TABLE "publication_issues" RENAME TO "magazines";
ALTER TABLE "issue_articles" RENAME TO "magazine_articles";
ALTER TABLE "magazine_articles" RENAME COLUMN "issue_id" TO "magazine_id";

-- Enums
ALTER TYPE "IssueStatus" RENAME TO "MagazineStatus";
ALTER TYPE "NotificationType" RENAME VALUE 'ISSUE_PUBLISHED' TO 'MAGAZINE_PUBLISHED';

-- Primary keys
ALTER TABLE "magazines" RENAME CONSTRAINT "publication_issues_pkey" TO "magazines_pkey";
ALTER TABLE "magazine_articles" RENAME CONSTRAINT "issue_articles_pkey" TO "magazine_articles_pkey";

-- Foreign keys
ALTER TABLE "magazines" RENAME CONSTRAINT "publication_issues_cover_media_id_fkey" TO "magazines_cover_media_id_fkey";
ALTER TABLE "magazines" RENAME CONSTRAINT "publication_issues_pdf_media_id_fkey" TO "magazines_pdf_media_id_fkey";
ALTER TABLE "magazine_articles" RENAME CONSTRAINT "issue_articles_issue_id_fkey" TO "magazine_articles_magazine_id_fkey";
ALTER TABLE "magazine_articles" RENAME CONSTRAINT "issue_articles_article_id_fkey" TO "magazine_articles_article_id_fkey";

-- Indexes
ALTER INDEX "publication_issues_slug_key" RENAME TO "magazines_slug_key";
ALTER INDEX "publication_issues_status_published_at_idx" RENAME TO "magazines_status_published_at_idx";
ALTER INDEX "publication_issues_volume_number_issue_number_key" RENAME TO "magazines_volume_number_issue_number_key";
ALTER INDEX "issue_articles_issue_id_display_order_idx" RENAME TO "magazine_articles_magazine_id_display_order_idx";
ALTER INDEX "issue_articles_article_id_idx" RENAME TO "magazine_articles_article_id_idx";
