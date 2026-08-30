-- Adds an optional author portrait to a magazine's editorial. Same shape as
-- the existing cover_media_id/pdf_media_id columns: nullable, SET NULL on
-- delete so removing the underlying media asset never fails or cascades.
ALTER TABLE "magazines" ADD COLUMN "editorial_author_image_id" UUID;

ALTER TABLE "magazines" ADD CONSTRAINT "magazines_editorial_author_image_id_fkey" FOREIGN KEY ("editorial_author_image_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
