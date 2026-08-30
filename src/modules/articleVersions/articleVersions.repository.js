/**
 * Prisma access for ArticleVersion and its content blocks. Blocks have no
 * lifecycle independent of the version that owns them — no routes, no
 * business rules of their own — so they live here rather than in a separate
 * `contentBlocks` module (an unforced split the plan's file listing suggests
 * but this codebase doesn't need yet).
 *
 * Every function accepts an optional Prisma client (`db`), same convention
 * as articles.repository.js — lets the service compose these into one
 * transaction.
 */
import prisma from "../../config/db.js";

const WITH_BLOCKS = { blocks: { orderBy: { blockOrder: "asc" } } };

export function create(
  {
    articleId,
    versionNumber,
    createdBy,
    status,
    title,
    subtitle,
    summary,
    authorName,
    authorBio,
    categoryId,
    coverMediaId,
    contentMode,
    pdfMediaId,
    pdfPageCount,
    readingMinutes,
  },
  db = prisma,
) {
  return db.articleVersion.create({
    data: {
      articleId,
      versionNumber,
      createdBy,
      status,
      title,
      subtitle,
      summary,
      authorName,
      authorBio,
      categoryId,
      coverMediaId,
      contentMode,
      pdfMediaId,
      pdfPageCount,
      readingMinutes,
    },
  });
}

export function findById(id, db = prisma) {
  return db.articleVersion.findUnique({ where: { id }, include: WITH_BLOCKS });
}

export function updateMetadata(id, data, db = prisma) {
  return db.articleVersion.update({ where: { id }, data });
}

export function updateStatus(id, status, timestampField, db = prisma) {
  const data = { status };
  if (timestampField) data[timestampField] = new Date();
  return db.articleVersion.update({ where: { id }, data });
}

/**
 * Replaces every block on a version in one shot: delete what's there, insert
 * the new set with `blockOrder` freshly assigned as 1..N from array position.
 * This is what makes "block writes are diffed and replaced" (plan §4 Phase
 * 5) actually true — order can never end up with gaps or duplicates, because
 * it's never edited in place.
 */
export async function replaceBlocks(versionId, blocks, db = prisma) {
  await db.articleContentBlock.deleteMany({ where: { articleVersionId: versionId } });
  if (blocks.length === 0) return [];

  await db.articleContentBlock.createMany({
    data: blocks.map((block, index) => ({
      articleVersionId: versionId,
      blockOrder: index + 1,
      blockType: block.blockType,
      content: block.content,
    })),
  });

  return db.articleContentBlock.findMany({
    where: { articleVersionId: versionId },
    orderBy: { blockOrder: "asc" },
  });
}

export function countByArticleId(articleId, db = prisma) {
  return db.articleVersion.count({ where: { articleId } });
}

/** Summaries only (no blocks) — the admin "version history" list view. */
export function findAllByArticleId(articleId, db = prisma) {
  return db.articleVersion.findMany({
    where: { articleId },
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
      status: true,
      title: true,
      createdAt: true,
      submittedAt: true,
      approvedAt: true,
      rejectedAt: true,
    },
  });
}
