/**
 * Public read queries (Phase 4) hard-code `status: "PUBLISHED"` so a public
 * route literally cannot see a draft (IMPLEMENTATION_PLAN.md §2/§45 rule 30).
 *
 * The write-side functions below (Phase 5) are the reusable "article core"
 * that the publisher and admin workflows (Phases 6–7) both call into —
 * ownership/role checks and status-transition rules belong in *their*
 * services, not here; this file only ever does the Prisma access.
 */
import prisma from "../../config/db.js";
import { toSkipTake } from "../../utils/pagination.js";

const LIST_INCLUDE = {
  category: true,
  cover: true,
  topics: { include: { topic: true } },
  tags: { include: { tag: true } },
  magazines: {
    include: {
      magazine: {
        select: { id: true, slug: true, volumeNumber: true, issueNumber: true, period: true },
      },
    },
  },
  currentPublishedVersion: { select: { readingMinutes: true } },
};

const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  pdf: true,
  currentPublishedVersion: {
    include: { blocks: { orderBy: { blockOrder: "asc" } } },
  },
};

function buildWhere({ category, topic, tag, issue, featured }) {
  const where = { status: "PUBLISHED" };
  if (category) where.category = { slug: category };
  if (topic) where.topics = { some: { topic: { slug: topic } } };
  if (tag) where.tags = { some: { tag: { slug: tag } } };
  if (issue) where.magazines = { some: { magazine: { slug: issue } } };
  if (featured !== undefined) where.isFeatured = featured;
  return where;
}

export async function findPublishedList({ page, limit, sort, ...filters }) {
  const where = buildWhere(filters);
  const orderBy = { publishedAt: sort === "oldest" ? "asc" : "desc" };

  const [items, total] = await Promise.all([
    prisma.article.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy,
      ...toSkipTake({ page, limit }),
    }),
    prisma.article.count({ where }),
  ]);
  return { items, total };
}

/**
 * `findFirst`, not `findUnique` — the slug's unique index still gets used by
 * Postgres (equality predicate), but `findUnique` can't combine a unique
 * field with the `status` filter, and that filter is the whole point: it's
 * what makes "published only" a database-level guarantee rather than a
 * post-fetch check that's easy to forget at a new call site.
 */
export function findPublishedBySlug(slug) {
  return prisma.article.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: DETAIL_INCLUDE,
  });
}

// --- Write side (Phase 5 core; role/ownership checks live in the caller) ---
//
// Each function takes an optional Prisma client (`db`), defaulting to the
// global singleton. Passing a `$transaction` callback's `tx` client instead
// is what lets articles.service.js's createArticle() commit the article, its
// first version, and its blocks as a single atomic unit.

export async function slugExists(slug, db = prisma) {
  const existing = await db.article.findUnique({ where: { slug }, select: { id: true } });
  return existing !== null;
}

/**
 * `title`/`subtitle`/`summary`/`authorName`/`authorBio`/`categoryId`/
 * `coverMediaId` are the Article row's own denormalized copy of whichever
 * version is "current" — so a drafts list can render without joining to a
 * version, and a public reader never depends on version bookkeeping at all.
 * Populated here at creation, from version 1's own metadata.
 *
 * Deliberately NOT auto-resynced on every later edit: whether an edited
 * version's data should overwrite this snapshot depends on article-level
 * state this function doesn't have — safe for a from-scratch draft with no
 * public exposure (there's nothing else to show), unsafe for a revision in
 * progress on an already-published article, where the snapshot must keep
 * showing the *old* published version until admin approval (§29). That
 * decision belongs to the publisher/admin services that know which case
 * they're in (Phases 6–7), not to this repository.
 */
export function create({ slug, publisherId, ...snapshot }, db = prisma) {
  return db.article.create({ data: { slug, publisherId, status: "DRAFT", ...snapshot } });
}

export function findById(id, db = prisma) {
  return db.article.findUnique({ where: { id } });
}

/** By id, not slug — what a comment-by-articleId needs to check the target
 * is actually public before allowing a comment on it. */
export function findPublishedById(id, db = prisma) {
  return db.article.findFirst({ where: { id, status: "PUBLISHED" }, select: { id: true } });
}

const OWNER_DETAIL_INCLUDE = {
  category: true,
  cover: true,
  pdf: true,
  topics: { include: { topic: true } },
  tags: { include: { tag: true } },
  magazines: {
    include: {
      magazine: {
        select: {
          id: true,
          slug: true,
          volumeNumber: true,
          issueNumber: true,
          title: true,
          period: true,
        },
      },
    },
  },
  pendingVersion: {
    include: { blocks: { orderBy: { blockOrder: "asc" } }, pdf: true },
  },
  currentPublishedVersion: {
    include: { blocks: { orderBy: { blockOrder: "asc" } }, pdf: true },
  },
};

/** Full detail for the owning publisher/admin — both versions, with blocks. */
export function findByIdWithVersions(id, db = prisma) {
  return db.article.findUnique({ where: { id }, include: OWNER_DETAIL_INCLUDE });
}

export async function findOwnByPublisher({ publisherId, status, page, limit }, db = prisma) {
  const where = { publisherId, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    db.article.findMany({
      where,
      include: { category: true, cover: true },
      orderBy: { updatedAt: "desc" },
      ...toSkipTake({ page, limit }),
    }),
    db.article.count({ where }),
  ]);
  return { items, total };
}

export function setPendingVersion(id, pendingVersionId, db = prisma) {
  return db.article.update({ where: { id }, data: { pendingVersionId } });
}

export function setStatus(id, status, db = prisma) {
  return db.article.update({ where: { id }, data: { status } });
}

/** See create()'s comment — the same "only when safe" caveat applies here. */
export function updateSnapshot(id, snapshot, db = prisma) {
  return db.article.update({ where: { id }, data: snapshot });
}

export async function setTaxonomy(articleId, { topicIds, tagIds }, db = prisma) {
  if (topicIds !== undefined) {
    await db.articleTopic.deleteMany({ where: { articleId } });
    if (topicIds.length > 0) {
      await db.articleTopic.createMany({
        data: topicIds.map((topicId) => ({ articleId, topicId })),
      });
    }
  }
  if (tagIds !== undefined) {
    await db.articleTag.deleteMany({ where: { articleId } });
    if (tagIds.length > 0) {
      await db.articleTag.createMany({ data: tagIds.map((tagId) => ({ articleId, tagId })) });
    }
  }
}

// --- Search (Phase 10) -------------------------------------------------

/** The names search_vector's "taxonomy" weight (C) is built from — category
 * plus every attached topic and tag. Everything else search_vector weighs
 * (title/subtitle/summary/authorName, weights A/B/D) reads straight off
 * Article's own columns via the generated column expression itself, so only
 * this joined-table-derived piece needs fetching and re-denormalizing. */
export async function findTaxonomyNames(articleId, db = prisma) {
  const article = await db.article.findUnique({
    where: { id: articleId },
    select: {
      category: { select: { name: true } },
      topics: { select: { topic: { select: { name: true } } } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (!article) return null;
  return {
    categoryName: article.category?.name ?? null,
    topicNames: article.topics.map((t) => t.topic.name),
    tagNames: article.tags.map((t) => t.tag.name),
  };
}

export function updateSearchText(articleId, searchText, db = prisma) {
  return db.article.update({ where: { id: articleId }, data: { searchText } });
}

/** DRAFT, never-published articles only — enforced by the caller. Cascades
 * to the article's version(s) and their blocks. */
export function remove(id, db = prisma) {
  return db.article.delete({ where: { id } });
}

// --- Admin-only queries ------------------------------------------------------

/** Articles whose pending version is awaiting a decision — the review queue,
 * oldest submission first (FIFO). */
export async function findReviewQueue({ page, limit }, db = prisma) {
  const where = { pendingVersion: { status: "PENDING_REVIEW" } };
  const [items, total] = await Promise.all([
    db.article.findMany({
      where,
      include: {
        category: true,
        publisher: { select: { id: true, name: true, email: true } },
        pendingVersion: { select: { versionNumber: true, submittedAt: true } },
      },
      orderBy: { pendingVersion: { submittedAt: "asc" } },
      ...toSkipTake({ page, limit }),
    }),
    db.article.count({ where }),
  ]);
  return { items, total };
}

/** Every article, any owner — admin's unrestricted list, filterable. */
export async function findAllForAdmin(
  { status, publisherId, search, magazineId, volume, page, limit },
  db = prisma,
) {
  const where = {
    ...(status ? { status } : {}),
    ...(publisherId ? { publisherId } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { authorName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
    // Both narrow the same `magazines` relation — they must merge into one
    // `some` clause, not two separate spreads (the second would silently
    // clobber the first, since both use the `magazines` key).
    ...(magazineId || volume
      ? {
          magazines: {
            some: {
              ...(magazineId ? { magazineId } : {}),
              ...(volume ? { magazine: { volumeNumber: volume } } : {}),
            },
          },
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.article.findMany({
      where,
      include: {
        category: true,
        cover: true,
        publisher: { select: { id: true, name: true, email: true } },
        magazines: {
          include: {
            magazine: {
              select: {
                id: true,
                slug: true,
                volumeNumber: true,
                issueNumber: true,
                title: true,
                period: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      ...toSkipTake({ page, limit }),
    }),
    db.article.count({ where }),
  ]);
  return { items, total };
}

/**
 * The approve/direct-publish transition, in one write: status, both
 * pointers, the publish timestamp, and the denormalized snapshot all change
 * together. Unlike `create()`/`updateSnapshot()`, this one has no "only when
 * safe" caveat — a version being promoted through this function *is*
 * becoming the article's public truth, so syncing the snapshot from it is
 * always correct here.
 */
export function markPublished(id, versionId, snapshot, db = prisma) {
  return db.article.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      currentPublishedVersionId: versionId,
      pendingVersionId: null,
      publishedAt: new Date(),
      ...snapshot,
    },
  });
}
