import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

const ARTICLE_SUMMARY_INCLUDE = {
  category: true,
  cover: true,
  topics: { include: { topic: true } },
  tags: { include: { tag: true } },
  currentPublishedVersion: { select: { readingMinutes: true } },
};

export async function findPublishedList({ page, limit }) {
  const where = { status: "PUBLISHED" };
  const [items, total] = await Promise.all([
    prisma.magazine.findMany({
      where,
      include: { cover: true },
      orderBy: [{ volumeNumber: "desc" }, { issueNumber: "desc" }],
      ...toSkipTake({ page, limit }),
    }),
    prisma.magazine.count({ where }),
  ]);
  return { items, total };
}

export function findPublishedBySlug(slug) {
  return prisma.magazine.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: {
      cover: true,
      pdf: true,
      editorialAuthorImage: true,
      articles: {
        orderBy: { displayOrder: "asc" },
        include: { article: { include: ARTICLE_SUMMARY_INCLUDE } },
      },
    },
  });
}
