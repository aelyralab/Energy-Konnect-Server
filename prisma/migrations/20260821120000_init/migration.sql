-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'PUBLISHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('heading', 'paragraph', 'image', 'quote', 'callout', 'table', 'figure', 'list', 'formula', 'reference');

-- CreateEnum
CREATE TYPE "ReviewActionType" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'PUBLISHED_DIRECT', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ARTICLE_PUBLISHED', 'ARTICLE_APPROVED', 'ARTICLE_REJECTED', 'ISSUE_PUBLISHED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('EMAIL_VERIFICATION');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "email_notifications" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_email_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL DEFAULT 'EMAIL_VERIFICATION',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" UUID,
    "user_agent" VARCHAR(400),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_topics" (
    "article_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,

    CONSTRAINT "article_topics_pkey" PRIMARY KEY ("article_id","topic_id")
);

-- CreateTable
CREATE TABLE "article_tags" (
    "article_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "article_tags_pkey" PRIMARY KEY ("article_id","tag_id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "subtitle" VARCHAR(400),
    "summary" TEXT,
    "author_name" VARCHAR(200) NOT NULL,
    "author_bio" TEXT,
    "category_id" UUID,
    "publisher_id" UUID NOT NULL,
    "cover_media_id" UUID,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "current_published_version_id" UUID,
    "pending_version_id" UUID,
    "search_text" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_versions" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(300) NOT NULL,
    "subtitle" VARCHAR(400),
    "summary" TEXT,
    "author_name" VARCHAR(200) NOT NULL,
    "author_bio" TEXT,
    "category_id" UUID,
    "cover_media_id" UUID,
    "reading_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),

    CONSTRAINT "article_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_content_blocks" (
    "id" UUID NOT NULL,
    "article_version_id" UUID NOT NULL,
    "block_order" INTEGER NOT NULL,
    "block_type" "BlockType" NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_review_actions" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "article_version_id" UUID,
    "actor_id" UUID,
    "action" "ReviewActionType" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_review_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_issues" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "volume_number" INTEGER NOT NULL,
    "issue_number" INTEGER NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "period" VARCHAR(120),
    "theme" VARCHAR(300),
    "description" TEXT,
    "cover_media_id" UUID,
    "pdf_media_id" UUID,
    "status" "IssueStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publication_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_articles" (
    "issue_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "section_label" VARCHAR(120),

    CONSTRAINT "issue_articles_pkey" PRIMARY KEY ("issue_id","article_id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "article_id" UUID,
    "title" VARCHAR(300) NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_notifications" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "recipient_email" VARCHAR(320) NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" VARCHAR(200),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_reads" (
    "id" UUID NOT NULL,
    "guest_id" VARCHAR(64) NOT NULL,
    "article_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE INDEX "user_email_verifications_user_id_purpose_consumed_at_idx" ON "user_email_verifications"("user_id", "purpose", "consumed_at");

-- CreateIndex
CREATE INDEX "user_email_verifications_expires_at_idx" ON "user_email_verifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_is_active_idx" ON "categories"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "topics_name_key" ON "topics"("name");

-- CreateIndex
CREATE UNIQUE INDEX "topics_slug_key" ON "topics"("slug");

-- CreateIndex
CREATE INDEX "topics_is_active_idx" ON "topics"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "article_topics_topic_id_idx" ON "article_topics"("topic_id");

-- CreateIndex
CREATE INDEX "article_tags_tag_id_idx" ON "article_tags"("tag_id");

-- CreateIndex
CREATE INDEX "media_assets_uploaded_by_created_at_idx" ON "media_assets"("uploaded_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "articles_current_published_version_id_key" ON "articles"("current_published_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "articles_pending_version_id_key" ON "articles"("pending_version_id");

-- CreateIndex
CREATE INDEX "articles_status_published_at_idx" ON "articles"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "articles_category_id_status_idx" ON "articles"("category_id", "status");

-- CreateIndex
CREATE INDEX "articles_publisher_id_status_updated_at_idx" ON "articles"("publisher_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "articles_is_featured_published_at_idx" ON "articles"("is_featured", "published_at" DESC);

-- CreateIndex
CREATE INDEX "article_versions_article_id_status_idx" ON "article_versions"("article_id", "status");

-- CreateIndex
CREATE INDEX "article_versions_status_submitted_at_idx" ON "article_versions"("status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "article_versions_article_id_version_number_key" ON "article_versions"("article_id", "version_number");

-- CreateIndex
CREATE INDEX "article_content_blocks_article_version_id_block_order_idx" ON "article_content_blocks"("article_version_id", "block_order");

-- CreateIndex
CREATE UNIQUE INDEX "article_content_blocks_article_version_id_block_order_key" ON "article_content_blocks"("article_version_id", "block_order");

-- CreateIndex
CREATE INDEX "article_review_actions_article_id_created_at_idx" ON "article_review_actions"("article_id", "created_at");

-- CreateIndex
CREATE INDEX "article_review_actions_action_created_at_idx" ON "article_review_actions"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "publication_issues_slug_key" ON "publication_issues"("slug");

-- CreateIndex
CREATE INDEX "publication_issues_status_published_at_idx" ON "publication_issues"("status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "publication_issues_volume_number_issue_number_key" ON "publication_issues"("volume_number", "issue_number");

-- CreateIndex
CREATE INDEX "issue_articles_issue_id_display_order_idx" ON "issue_articles"("issue_id", "display_order");

-- CreateIndex
CREATE INDEX "issue_articles_article_id_idx" ON "issue_articles"("article_id");

-- CreateIndex
CREATE INDEX "comments_article_id_is_deleted_created_at_idx" ON "comments"("article_id", "is_deleted", "created_at");

-- CreateIndex
CREATE INDEX "comments_user_id_idx" ON "comments"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "email_notifications_status_created_at_idx" ON "email_notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "guest_reads_guest_id_idx" ON "guest_reads"("guest_id");

-- CreateIndex
CREATE INDEX "guest_reads_created_at_idx" ON "guest_reads"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "guest_reads_guest_id_article_id_key" ON "guest_reads"("guest_id", "article_id");

-- AddForeignKey
ALTER TABLE "user_email_verifications" ADD CONSTRAINT "user_email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_topics" ADD CONSTRAINT "article_topics_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_topics" ADD CONSTRAINT "article_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "article_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_pending_version_id_fkey" FOREIGN KEY ("pending_version_id") REFERENCES "article_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_content_blocks" ADD CONSTRAINT "article_content_blocks_article_version_id_fkey" FOREIGN KEY ("article_version_id") REFERENCES "article_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_review_actions" ADD CONSTRAINT "article_review_actions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_review_actions" ADD CONSTRAINT "article_review_actions_article_version_id_fkey" FOREIGN KEY ("article_version_id") REFERENCES "article_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_review_actions" ADD CONSTRAINT "article_review_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_issues" ADD CONSTRAINT "publication_issues_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_issues" ADD CONSTRAINT "publication_issues_pdf_media_id_fkey" FOREIGN KEY ("pdf_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_articles" ADD CONSTRAINT "issue_articles_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "publication_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_articles" ADD CONSTRAINT "issue_articles_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_notifications" ADD CONSTRAINT "email_notifications_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_reads" ADD CONSTRAINT "guest_reads_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

