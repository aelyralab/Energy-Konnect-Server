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
