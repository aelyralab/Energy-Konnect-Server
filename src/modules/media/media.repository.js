import { Prisma } from "@prisma/client";
import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

export function create(data) {
  return prisma.mediaAsset.create({ data });
}

export function findById(id) {
  return prisma.mediaAsset.findUnique({ where: { id } });
}

export async function findAll({ page, limit }) {
  const [items, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      include: { uploader: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      ...toSkipTake({ page, limit }),
    }),
    prisma.mediaAsset.count(),
  ]);
  return { items, total };
}

/**
 * Everywhere a media asset can still be in use. The cover/PDF/author-image
 * columns are real foreign keys (ON DELETE SET NULL), so deleting the row
 * would silently blank those out rather than error — that's exactly the
 * silent-breakage a delete feature must not do, so it's surfaced here
 * instead and left for the caller to block on. Embedded references (an
 * image/figure block's `content.mediaId`, or an editorial body's block
 * array) aren't foreign keys at all — nothing in the database would stop
 * the delete otherwise.
 */
export async function findUsage(id) {
  const [
    articleCovers,
    articlePdfs,
    versionCovers,
    versionPdfs,
    magazineCovers,
    magazinePdfs,
    magazineAuthorImages,
    contentBlockRefs,
    magazinesWithEditorialBody,
  ] = await Promise.all([
    prisma.article.count({ where: { coverMediaId: id } }),
    prisma.article.count({ where: { pdfMediaId: id } }),
    prisma.articleVersion.count({ where: { coverMediaId: id } }),
    prisma.articleVersion.count({ where: { pdfMediaId: id } }),
    prisma.magazine.count({ where: { coverMediaId: id } }),
    prisma.magazine.count({ where: { pdfMediaId: id } }),
    prisma.magazine.count({ where: { editorialAuthorImageId: id } }),
    prisma.articleContentBlock.count({ where: { content: { path: ["mediaId"], equals: id } } }),
    // Small, fixed-size table (one row per magazine) — cheaper to filter in
    // JS than to hand-write a JSONB array-containment query for one column.
    prisma.magazine.findMany({
      where: { editorialBody: { not: Prisma.DbNull } },
      select: { editorialBody: true },
    }),
  ]);

  const editorialBodyRefs = magazinesWithEditorialBody.filter((magazine) =>
    (magazine.editorialBody ?? []).some((block) => block?.content?.mediaId === id),
  ).length;

  return {
    covers: articleCovers + magazineCovers,
    pdfs: articlePdfs + magazinePdfs,
    versionCovers,
    versionPdfs,
    authorImages: magazineAuthorImages,
    blocks: contentBlockRefs + editorialBodyRefs,
  };
}

export function remove(id) {
  return prisma.mediaAsset.delete({ where: { id } });
}
