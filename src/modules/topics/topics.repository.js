import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

export function findAllActive() {
  return prisma.topic.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
}

export async function findAll({ page, limit, search }) {
  const where = search ? { name: { contains: search, mode: "insensitive" } } : undefined;

  const [items, total] = await Promise.all([
    prisma.topic.findMany({ where, orderBy: { name: "asc" }, ...toSkipTake({ page, limit }) }),
    prisma.topic.count({ where }),
  ]);
  return { items, total };
}

export function findById(id) {
  return prisma.topic.findUnique({ where: { id } });
}

export function findBySlug(slug) {
  return prisma.topic.findUnique({ where: { slug } });
}

export async function slugExists(slug) {
  const existing = await prisma.topic.findUnique({ where: { slug }, select: { id: true } });
  return existing !== null;
}

export function create(data) {
  return prisma.topic.create({ data });
}

export function update(id, data) {
  return prisma.topic.update({ where: { id }, data });
}

export function remove(id) {
  return prisma.topic.delete({ where: { id } });
}

export function countReferences(id) {
  return prisma.articleTopic.count({ where: { topicId: id } });
}
