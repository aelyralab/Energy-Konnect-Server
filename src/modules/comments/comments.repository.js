import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

const WITH_AUTHOR = { user: { select: { id: true, name: true, isActive: true } } };

export function create({ articleId, userId, content }) {
  return prisma.comment.create({ data: { articleId, userId, content }, include: WITH_AUTHOR });
}

/** Unfiltered by isDeleted — the delete endpoint needs to load a comment
 * (for its ownership check) regardless of whether it's already deleted. */
export function findById(id) {
  return prisma.comment.findUnique({ where: { id } });
}

export async function findByArticleId({ articleId, page, limit }) {
  const where = { articleId, isDeleted: false };
  const [items, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      include: WITH_AUTHOR,
      orderBy: { createdAt: "asc" },
      ...toSkipTake({ page, limit }),
    }),
    prisma.comment.count({ where }),
  ]);
  return { items, total };
}

export function softDelete(id) {
  return prisma.comment.update({ where: { id }, data: { isDeleted: true } });
}
