import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

export function findAllActive() {
  return prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
}

export async function findAll({ page, limit, search }) {
  const where = search ? { name: { contains: search, mode: "insensitive" } } : undefined;

  const [items, total] = await Promise.all([
    prisma.category.findMany({ where, orderBy: { name: "asc" }, ...toSkipTake({ page, limit }) }),
    prisma.category.count({ where }),
  ]);
  return { items, total };
}

export function findById(id) {
  return prisma.category.findUnique({ where: { id } });
}

export function findBySlug(slug) {
  return prisma.category.findUnique({ where: { slug } });
}

export async function slugExists(slug) {
  const existing = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  return existing !== null;
}

export function create(data) {
  return prisma.category.create({ data });
}

export function update(id, data) {
  return prisma.category.update({ where: { id }, data });
}

export function remove(id) {
  return prisma.category.delete({ where: { id } });
}

/** Blocks delete when a category is still in use — see categories.service.js. */
export async function countReferences(id) {
  const [articleCount, versionCount] = await Promise.all([
    prisma.article.count({ where: { categoryId: id } }),
    prisma.articleVersion.count({ where: { categoryId: id } }),
  ]);
  return articleCount + versionCount;
}
