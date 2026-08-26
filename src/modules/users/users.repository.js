import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

export function findById(id) {
  return prisma.user.findUnique({ where: { id } });
}

export function update(id, data) {
  return prisma.user.update({ where: { id }, data });
}

export function revokeAllRefreshTokens(userId) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// --- Admin-only --------------------------------------------------------

export async function findAllForAdmin({ role, search, page, limit }) {
  const where = {
    ...(role ? { role } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, ...toSkipTake({ page, limit }) }),
    prisma.user.count({ where }),
  ]);
  return { items, total };
}
