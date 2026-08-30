-- CreateEnum
CREATE TYPE "ContentMode" AS ENUM ('BLOCKS', 'PDF');

-- AlterTable
ALTER TABLE "articles"
  ADD COLUMN "content_mode" "ContentMode" NOT NULL DEFAULT 'BLOCKS',
  ADD COLUMN "pdf_media_id" UUID,
  ADD COLUMN "pdf_page_count" INTEGER;

-- AlterTable
ALTER TABLE "article_versions"
  ADD COLUMN "content_mode" "ContentMode" NOT NULL DEFAULT 'BLOCKS',
  ADD COLUMN "pdf_media_id" UUID,
  ADD COLUMN "pdf_page_count" INTEGER;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_pdf_media_id_fkey" FOREIGN KEY ("pdf_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_pdf_media_id_fkey" FOREIGN KEY ("pdf_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
