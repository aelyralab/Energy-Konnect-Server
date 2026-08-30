import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

const DETAIL_INCLUDE = {
  cover: true,
  pdf: true,
  articles: {
    orderBy: { displayOrder: "asc" },
    include: {
      article: {
        select: { id: true, slug: true, title: true, status: true, publisherId: true },
      },
    },
  },
  _count: { select: { articles: true } },
};

export async function findAll({ page, limit, search }) {
  const where = search
    ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { theme: { contains: search, mode: "insensitive" } },
          { period: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.magazine.findMany({
      where,
      include: { cover: true, _count: { select: { articles: true } } },
      orderBy: [{ volumeNumber: "desc" }, { issueNumber: "desc" }],
      ...toSkipTake({ page, limit }),
    }),
    prisma.magazine.count({ where }),
  ]);
  return { items, total };
}

export function findById(id, db = prisma) {
  return db.magazine.findUnique({ where: { id }, include: DETAIL_INCLUDE });
}

export async function slugExists(slug) {
  const existing = await prisma.magazine.findUnique({
    where: { slug },
    select: { id: true },
  });
  return existing !== null;
}

export function create(data, db = prisma) {
  return db.magazine.create({ data });
}

export function update(id, data, db = prisma) {
  return db.magazine.update({ where: { id }, data });
}

export function setStatus(id, status, publishedAt, db = prisma) {
  return db.magazine.update({
    where: { id },
    data: { status, ...(publishedAt !== undefined ? { publishedAt } : {}) },
  });
}

export function remove(id, db = prisma) {
  return db.magazine.delete({ where: { id } });
}

export function countArticles(magazineId, db = prisma) {
  return db.magazineArticle.count({ where: { magazineId } });
}

/** Where a newly-attached article lands by default — the end of the magazine. */
export async function nextDisplayOrder(magazineId, db = prisma) {
  const top = await db.magazineArticle.findFirst({
    where: { magazineId },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  return (top?.displayOrder ?? -1) + 1;
}

/** Upsert on the (magazineId, articleId) compound key — attaching an article
 * that's already attached just updates its section/order rather than erroring. */
export function attachArticle({ magazineId, articleId, sectionLabel, displayOrder }, db = prisma) {
  return db.magazineArticle.upsert({
    where: { magazineId_articleId: { magazineId, articleId } },
    create: { magazineId, articleId, sectionLabel, displayOrder },
    update: { sectionLabel, displayOrder },
  });
}

export function detachArticle(magazineId, articleId, db = prisma) {
  return db.magazineArticle.delete({ where: { magazineId_articleId: { magazineId, articleId } } });
}

export function articleIsAttached(magazineId, articleId, db = prisma) {
  return db.magazineArticle
    .findUnique({
      where: { magazineId_articleId: { magazineId, articleId } },
      select: { magazineId: true },
    })
    .then((row) => row !== null);
}

export function reorderArticle({ magazineId, articleId, displayOrder, sectionLabel }, db = prisma) {
  const data = { displayOrder };
  if (sectionLabel !== undefined) data.sectionLabel = sectionLabel;
  return db.magazineArticle.update({
    where: { magazineId_articleId: { magazineId, articleId } },
    data,
  });
}
