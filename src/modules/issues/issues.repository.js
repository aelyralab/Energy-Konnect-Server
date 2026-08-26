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
};

export async function findAll({ page, limit }) {
  const [items, total] = await Promise.all([
    prisma.publicationIssue.findMany({
      include: { cover: true },
      orderBy: [{ volumeNumber: "desc" }, { issueNumber: "desc" }],
      ...toSkipTake({ page, limit }),
    }),
    prisma.publicationIssue.count(),
  ]);
  return { items, total };
}

export function findById(id, db = prisma) {
  return db.publicationIssue.findUnique({ where: { id }, include: DETAIL_INCLUDE });
}

export async function slugExists(slug) {
  const existing = await prisma.publicationIssue.findUnique({
    where: { slug },
    select: { id: true },
  });
  return existing !== null;
}

export function create(data, db = prisma) {
  return db.publicationIssue.create({ data });
}

export function update(id, data, db = prisma) {
  return db.publicationIssue.update({ where: { id }, data });
}

export function setStatus(id, status, publishedAt, db = prisma) {
  return db.publicationIssue.update({
    where: { id },
    data: { status, ...(publishedAt !== undefined ? { publishedAt } : {}) },
  });
}

export function remove(id, db = prisma) {
  return db.publicationIssue.delete({ where: { id } });
}

export function countArticles(issueId, db = prisma) {
  return db.issueArticle.count({ where: { issueId } });
}

/** Upsert on the (issueId, articleId) compound key — attaching an article
 * that's already attached just updates its section/order rather than erroring. */
export function attachArticle({ issueId, articleId, sectionLabel, displayOrder }, db = prisma) {
  return db.issueArticle.upsert({
    where: { issueId_articleId: { issueId, articleId } },
    create: { issueId, articleId, sectionLabel, displayOrder },
    update: { sectionLabel, displayOrder },
  });
}

export function detachArticle(issueId, articleId, db = prisma) {
  return db.issueArticle.delete({ where: { issueId_articleId: { issueId, articleId } } });
}

export function articleIsAttached(issueId, articleId, db = prisma) {
  return db.issueArticle
    .findUnique({ where: { issueId_articleId: { issueId, articleId } }, select: { issueId: true } })
    .then((row) => row !== null);
}

export function reorderArticle({ issueId, articleId, displayOrder, sectionLabel }, db = prisma) {
  const data = { displayOrder };
  if (sectionLabel !== undefined) data.sectionLabel = sectionLabel;
  return db.issueArticle.update({ where: { issueId_articleId: { issueId, articleId } }, data });
}
