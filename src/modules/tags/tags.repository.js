import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

export function findAll() {
  return prisma.tag.findMany({ orderBy: { name: "asc" } });
}

export async function findPage({ page, limit, search }) {
  const where = search ? { name: { contains: search, mode: "insensitive" } } : undefined;

  const [items, total] = await Promise.all([
    prisma.tag.findMany({ where, orderBy: { name: "asc" }, ...toSkipTake({ page, limit }) }),
    prisma.tag.count({ where }),
  ]);
  return { items, total };
}

export function findById(id) {
  return prisma.tag.findUnique({ where: { id } });
}

export function findBySlug(slug) {
  return prisma.tag.findUnique({ where: { slug } });
}

export async function slugExists(slug) {
  const existing = await prisma.tag.findUnique({ where: { slug }, select: { id: true } });
  return existing !== null;
}

export function create(data) {
  return prisma.tag.create({ data });
}

export function update(id, data) {
  return prisma.tag.update({ where: { id }, data });
}

export function remove(id) {
  return prisma.tag.delete({ where: { id } });
}

export function countReferences(id) {
  return prisma.articleTag.count({ where: { tagId: id } });
}
