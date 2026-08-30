/**
 * Magazine management (context doc §19–21; IMPLEMENTATION_PLAN.md Phase 7).
 * The load-bearing rule throughout this file: a magazine's status and an
 * article's status are independent (§21, rule 18) — publishing a magazine
 * only ever changes the magazine row. It never touches `articles.status`,
 * so a DRAFT or PENDING_REVIEW article attached to a newly-published
 * magazine stays exactly as invisible to the public as it was (enforced
 * downstream by archive.repository.js/magazine.serializer.js's
 * PUBLISHED-only filter on magazine contents, unchanged since Phase 4).
 */
import prisma from "../../config/db.js";
import ApiError from "../../utils/ApiError.js";
import { uniqueSlug } from "../../utils/slug.js";
import * as repo from "./magazines.repository.js";
import * as notificationsService from "../notifications/notifications.service.js";

async function getOrThrow(id) {
  const magazine = await repo.findById(id);
  if (!magazine) throw ApiError.notFound("Magazine not found");
  return magazine;
}

export async function listAll({ q, ...query }) {
  const { items, total } = await repo.findAll({ ...query, search: q });
  return { items, total, page: query.page, limit: query.limit };
}

export function getById(id) {
  return getOrThrow(id);
}

// create/update/publish/archive all re-read through getOrThrow() rather than
// returning their raw mutation result — repo.create/update/setStatus don't
// include the cover/pdf/articles relations, and a caller getting back a
// magazine that looks like it has no articles right after attaching one
// would be a confusing, easy-to-miss inconsistency with getById()'s response.

export async function create(data) {
  const slug = await uniqueSlug(
    `Volume ${data.volumeNumber} Issue ${data.issueNumber}`,
    repo.slugExists,
  );
  const magazine = await repo.create({ ...data, slug, status: "DRAFT" });
  return getOrThrow(magazine.id);
}

export async function update(id, data) {
  await getOrThrow(id);
  await repo.update(id, data);
  return getOrThrow(id);
}

export async function remove(id) {
  const magazine = await getOrThrow(id);
  if (magazine.status !== "DRAFT") {
    throw ApiError.conflict(
      "Only a draft magazine can be deleted — archive it instead",
      "MAGAZINE_NOT_DELETABLE",
    );
  }
  const articleCount = await repo.countArticles(id);
  if (articleCount > 0) {
    throw ApiError.conflict(
      `Cannot delete — ${articleCount} article(s) are still attached to this magazine`,
      "MAGAZINE_HAS_ARTICLES",
    );
  }
  await repo.remove(id);
}

export async function attachArticle(magazineId, { articleId, sectionLabel, displayOrder }) {
  await getOrThrow(magazineId);
  await repo.attachArticle({ magazineId, articleId, sectionLabel, displayOrder });
  return getOrThrow(magazineId);
}

export async function detachArticle(magazineId, articleId) {
  await getOrThrow(magazineId);
  const attached = await repo.articleIsAttached(magazineId, articleId);
  if (!attached) throw ApiError.notFound("This article is not attached to this magazine");
  await repo.detachArticle(magazineId, articleId);
}

export async function reorderArticles(magazineId, articles) {
  await getOrThrow(magazineId);
  for (const entry of articles) {
    const attached = await repo.articleIsAttached(magazineId, entry.articleId);
    if (!attached) {
      throw ApiError.badRequest(
        `Article ${entry.articleId} is not attached to this magazine`,
        { field: "articles" },
        "ARTICLE_NOT_ATTACHED",
      );
    }
  }
  // Batch transaction — all reorder writes commit together or not at all,
  // so a mid-batch failure can never leave display order half-updated.
  await prisma.$transaction(articles.map((entry) => repo.reorderArticle({ magazineId, ...entry })));
  return getOrThrow(magazineId);
}

export async function publish(id) {
  const magazine = await getOrThrow(id);
  if (magazine.status !== "DRAFT") {
    throw ApiError.conflict("Only a draft magazine can be published", "NOT_DRAFT");
  }
  // Transactional with the notification fan-out for the same reason as
  // admin.service.js's promoteToPublished — a crash here must not leave a
  // published magazine with no notifications, or notifications for a
  // publish that never committed.
  await prisma.$transaction(async (tx) => {
    await repo.setStatus(id, "PUBLISHED", new Date(), tx);
    await notificationsService.notifyMagazinePublished(magazine, tx);
  });
  return getOrThrow(id);
}

export async function archive(id) {
  const magazine = await getOrThrow(id);
  if (!["DRAFT", "PUBLISHED"].includes(magazine.status)) {
    throw ApiError.conflict("This magazine is already archived", "ALREADY_ARCHIVED");
  }
  await repo.setStatus(id, "ARCHIVED", undefined);
  return getOrThrow(id);
}
