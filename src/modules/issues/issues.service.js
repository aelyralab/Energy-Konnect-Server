/**
 * Publication issue management (context doc §19–21; IMPLEMENTATION_PLAN.md
 * Phase 7). The load-bearing rule throughout this file: an issue's status
 * and an article's status are independent (§21, rule 18) — publishing an
 * issue only ever changes the issue row. It never touches
 * `articles.status`, so a DRAFT or PENDING_REVIEW article attached to a
 * newly-published issue stays exactly as invisible to the public as it was
 * (enforced downstream by publications.repository.js/issue.serializer.js's
 * PUBLISHED-only filter on issue contents, unchanged since Phase 4).
 */
import prisma from "../../config/db.js";
import ApiError from "../../utils/ApiError.js";
import { uniqueSlug } from "../../utils/slug.js";
import * as repo from "./issues.repository.js";
import * as notificationsService from "../notifications/notifications.service.js";

async function getOrThrow(id) {
  const issue = await repo.findById(id);
  if (!issue) throw ApiError.notFound("Publication issue not found");
  return issue;
}

export async function listAll(query) {
  const { items, total } = await repo.findAll(query);
  return { items, total, page: query.page, limit: query.limit };
}

export function getById(id) {
  return getOrThrow(id);
}

// create/update/publish/archive all re-read through getOrThrow() rather than
// returning their raw mutation result — repo.create/update/setStatus don't
// include the cover/pdf/articles relations, and a caller getting back an
// issue that looks like it has no articles right after attaching one would
// be a confusing, easy-to-miss inconsistency with getById()'s response.

export async function create(data) {
  const slug = await uniqueSlug(
    `Volume ${data.volumeNumber} Issue ${data.issueNumber}`,
    repo.slugExists,
  );
  const issue = await repo.create({ ...data, slug, status: "DRAFT" });
  return getOrThrow(issue.id);
}

export async function update(id, data) {
  await getOrThrow(id);
  await repo.update(id, data);
  return getOrThrow(id);
}

export async function remove(id) {
  const issue = await getOrThrow(id);
  if (issue.status !== "DRAFT") {
    throw ApiError.conflict(
      "Only a draft issue can be deleted — archive it instead",
      "ISSUE_NOT_DELETABLE",
    );
  }
  const articleCount = await repo.countArticles(id);
  if (articleCount > 0) {
    throw ApiError.conflict(
      `Cannot delete — ${articleCount} article(s) are still attached to this issue`,
      "ISSUE_HAS_ARTICLES",
    );
  }
  await repo.remove(id);
}

export async function attachArticle(issueId, { articleId, sectionLabel, displayOrder }) {
  await getOrThrow(issueId);
  await repo.attachArticle({ issueId, articleId, sectionLabel, displayOrder });
  return getOrThrow(issueId);
}

export async function detachArticle(issueId, articleId) {
  await getOrThrow(issueId);
  const attached = await repo.articleIsAttached(issueId, articleId);
  if (!attached) throw ApiError.notFound("This article is not attached to this issue");
  await repo.detachArticle(issueId, articleId);
}

export async function reorderArticles(issueId, articles) {
  await getOrThrow(issueId);
  for (const entry of articles) {
    const attached = await repo.articleIsAttached(issueId, entry.articleId);
    if (!attached) {
      throw ApiError.badRequest(
        `Article ${entry.articleId} is not attached to this issue`,
        { field: "articles" },
        "ARTICLE_NOT_ATTACHED",
      );
    }
  }
  // Batch transaction — all reorder writes commit together or not at all,
  // so a mid-batch failure can never leave display order half-updated.
  await prisma.$transaction(articles.map((entry) => repo.reorderArticle({ issueId, ...entry })));
  return getOrThrow(issueId);
}

export async function publish(id) {
  const issue = await getOrThrow(id);
  if (issue.status !== "DRAFT") {
    throw ApiError.conflict("Only a draft issue can be published", "NOT_DRAFT");
  }
  // Transactional with the notification fan-out for the same reason as
  // admin.service.js's promoteToPublished — a crash here must not leave a
  // published issue with no notifications, or notifications for a publish
  // that never committed.
  await prisma.$transaction(async (tx) => {
    await repo.setStatus(id, "PUBLISHED", new Date(), tx);
    await notificationsService.notifyIssuePublished(issue, tx);
  });
  return getOrThrow(id);
}

export async function archive(id) {
  const issue = await getOrThrow(id);
  if (!["DRAFT", "PUBLISHED"].includes(issue.status)) {
    throw ApiError.conflict("This issue is already archived", "ALREADY_ARCHIVED");
  }
  await repo.setStatus(id, "ARCHIVED", undefined);
  return getOrThrow(id);
}
