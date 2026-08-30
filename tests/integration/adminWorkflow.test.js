/**
 * Hits the live database directly through the service layer — no HTTP, no
 * mocks. Verifies Phase 7's explicit "done when" bar:
 *   1. approve/reject are covered, including the transaction rollback path.
 *   2. Publishing a magazine leaves its DRAFT and PENDING_REVIEW articles
 *      invisible to the public (§21, rule 18).
 * Plus the surrounding admin workflow: direct publish, edit-published
 * (§31), unpublish/archive, and user role administration.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "../../src/config/db.js";
import { retireTestUsers } from "../helpers/users.js";
import { hashPassword } from "../../src/utils/password.js";
import * as publisherService from "../../src/modules/publisher/publisher.service.js";
import * as adminService from "../../src/modules/admin/admin.service.js";
import * as magazinesService from "../../src/modules/magazines/magazines.service.js";
import * as usersService from "../../src/modules/users/users.service.js";
import * as articlesService from "../../src/modules/articles/articles.service.js";
import * as archiveService from "../../src/modules/archive/archive.service.js";
import * as commentsService from "../../src/modules/comments/comments.service.js";
import { serializeMagazineDetail } from "../../src/utils/serializers/magazine.serializer.js";

let publisherId;
let adminId;
let categoryId;
const createdArticleIds = [];
const createdMagazineIds = [];
const createdUserIds = [];

beforeAll(async () => {
  const category = await prisma.category.findFirst();
  if (!category) throw new Error("Seed data required — run `npm run seed` before the test suite");
  categoryId = category.id;

  const passwordHash = await hashPassword("Test-Password-123");
  const suffix = randomUUID().slice(0, 8);
  const [pub, admin] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Phase 7 Publisher",
        email: `phase7-pub-${suffix}@example.com`,
        passwordHash,
        role: "PUBLISHER",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "Phase 7 Admin",
        email: `phase7-admin-${suffix}@example.com`,
        passwordHash,
        role: "ADMIN",
        emailVerified: true,
      },
    }),
  ]);
  publisherId = pub.id;
  adminId = admin.id;
  createdUserIds.push(pub.id, admin.id);
});

afterAll(async () => {
  if (createdMagazineIds.length > 0) {
    await prisma.magazineArticle.deleteMany({
      where: { magazineId: { in: createdMagazineIds } },
    });
    await prisma.magazine.deleteMany({ where: { id: { in: createdMagazineIds } } });
  }
  if (createdArticleIds.length > 0) {
    await prisma.article.deleteMany({ where: { id: { in: createdArticleIds } } });
  }
  if (createdUserIds.length > 0) {
    await retireTestUsers(createdUserIds);
  }
});

function draftPayload(overrides = {}) {
  return {
    title: `Phase 7 draft ${Date.now()}-${Math.random().toString(36).slice(2)}`,
    summary: "A throwaway article for the admin workflow test suite.",
    authorName: "Test Author",
    categoryId,
    blocks: [{ blockType: "paragraph", content: { text: "Body text." } }],
    ...overrides,
  };
}

async function createSubmittedArticle(overrides = {}) {
  const article = await publisherService.createDraft(publisherId, draftPayload(overrides));
  createdArticleIds.push(article.id);
  return publisherService.submit(publisherId, article.id);
}

describe("admin workflow — approve", () => {
  it("promotes a submitted version to PUBLISHED: pointers, status, snapshot, audit row", async () => {
    const submitted = await createSubmittedArticle({ title: `Approve test ${Date.now()}` });

    const approved = await adminService.approve(adminId, submitted.id);
    expect(approved.status).toBe("PUBLISHED");
    expect(approved.currentPublishedVersionId).toBe(submitted.pendingVersion.id);
    expect(approved.pendingVersionId).toBeNull();
    expect(approved.currentPublishedVersion.status).toBe("PUBLISHED");
    // Snapshot synced from the version that just became public.
    expect(approved.title).toBe(submitted.pendingVersion.title);

    const history = await adminService.history(submitted.id);
    expect(history.map((h) => h.action)).toContain("APPROVED");
  });

  it("refuses to approve a version that was never submitted", async () => {
    const article = await publisherService.createDraft(publisherId, draftPayload());
    createdArticleIds.push(article.id);

    await expect(adminService.approve(adminId, article.id)).rejects.toMatchObject({
      code: "NOT_PENDING_REVIEW",
    });
  });

  it("approving a revision SUPERSEDES the previous published version rather than deleting it", async () => {
    const submitted = await createSubmittedArticle();
    const firstApproved = await adminService.approve(adminId, submitted.id);
    const firstVersionId = firstApproved.currentPublishedVersionId;

    await publisherService.revise(publisherId, submitted.id);
    await publisherService.submit(publisherId, submitted.id);
    const secondApproved = await adminService.approve(adminId, submitted.id);

    expect(secondApproved.currentPublishedVersionId).not.toBe(firstVersionId);
    const firstVersion = await prisma.articleVersion.findUnique({ where: { id: firstVersionId } });
    expect(firstVersion).not.toBeNull(); // still exists — historical record, not deleted
    expect(firstVersion.status).toBe("SUPERSEDED");
  });

  it("PHASE 7 DONE-WHEN: a failure inside the promotion transaction rolls back every write, not just some", async () => {
    // Construct a genuine constraint collision: two articles' published
    // versions cannot point at the same ArticleVersion row
    // (articles.currentPublishedVersionId is @unique). Approve article B
    // against article A's already-published version — the version-status
    // write and the SUPERSEDE write must both be undone when the final
    // pointer write hits that unique constraint.
    const submittedA = await createSubmittedArticle({ title: `Rollback A ${Date.now()}` });
    const approvedA = await adminService.approve(adminId, submittedA.id);
    const versionAId = approvedA.currentPublishedVersionId;

    const submittedB = await createSubmittedArticle({ title: `Rollback B ${Date.now()}` });
    const approvedB = await adminService.approve(adminId, submittedB.id);
    const versionBId = approvedB.currentPublishedVersionId;

    // Manually corrupt B so its "pending" version is A's live published
    // version, disguised as freshly submitted — this is test scaffolding to
    // reach the mid-transaction failure, not something the application can
    // produce on its own.
    await prisma.$transaction([
      prisma.articleVersion.update({
        where: { id: versionAId },
        data: { status: "PENDING_REVIEW" },
      }),
      prisma.article.update({
        where: { id: submittedB.id },
        data: { pendingVersionId: versionAId },
      }),
    ]);

    await expect(adminService.approve(adminId, submittedB.id)).rejects.toBeTruthy();

    // Every write inside the failed transaction must be undone.
    const versionAAfter = await prisma.articleVersion.findUnique({ where: { id: versionAId } });
    expect(versionAAfter.status).toBe("PENDING_REVIEW"); // NOT flipped to PUBLISHED
    const versionBAfter = await prisma.articleVersion.findUnique({ where: { id: versionBId } });
    expect(versionBAfter.status).toBe("PUBLISHED"); // NOT superseded
    const articleBAfter = await prisma.article.findUnique({ where: { id: submittedB.id } });
    expect(articleBAfter.currentPublishedVersionId).toBe(versionBId); // pointer untouched

    // No audit row from the failed attempt — B has exactly the one APPROVED
    // entry from its earlier, real approval.
    const historyB = await adminService.history(submittedB.id);
    expect(historyB.filter((h) => h.action === "APPROVED")).toHaveLength(1);
  });
});

describe("admin workflow — reject", () => {
  it("rejecting a brand-new article's first submission flips the article to REJECTED too", async () => {
    const submitted = await createSubmittedArticle();
    const rejected = await adminService.reject(adminId, submitted.id, "Needs more sourcing.");

    expect(rejected.status).toBe("REJECTED");
    expect(rejected.pendingVersion.status).toBe("REJECTED");
    expect(rejected.currentPublishedVersionId).toBeNull();

    const history = await adminService.history(submitted.id);
    const rejection = history.find((h) => h.action === "REJECTED");
    expect(rejection.reason).toBe("Needs more sourcing.");
  });

  it("rejecting a revision-in-progress leaves the article PUBLISHED — the old version stays live", async () => {
    const submitted = await createSubmittedArticle();
    await adminService.approve(adminId, submitted.id);

    await publisherService.revise(publisherId, submitted.id);
    await publisherService.submit(publisherId, submitted.id);
    const rejected = await adminService.reject(adminId, submitted.id, "Not this time.");

    expect(rejected.status).toBe("PUBLISHED"); // unchanged — old version still live
    expect(rejected.pendingVersion.status).toBe("REJECTED");
    expect(rejected.currentPublishedVersionId).not.toBeNull();
  });

  it("a rejected article can be resubmitted and later approved", async () => {
    const submitted = await createSubmittedArticle();
    await adminService.reject(adminId, submitted.id, "Fix the intro.");

    const resubmitted = await publisherService.submit(publisherId, submitted.id);
    expect(resubmitted.status).toBe("PENDING_REVIEW");

    const approved = await adminService.approve(adminId, submitted.id);
    expect(approved.status).toBe("PUBLISHED");
  });

  // "reason" being required and non-empty is enforced by admin.validation.js's
  // rejectSchema at the HTTP boundary (a route-layer concern, per this
  // codebase's convention that services trust already-validated input) —
  // covered by the manual HTTP verification pass, not here.
});

describe("admin workflow — direct publish and edit-published (§30, §31)", () => {
  it("publishDirect bypasses review entirely — a DRAFT (never submitted) can be published straight", async () => {
    const article = await publisherService.createDraft(publisherId, draftPayload());
    createdArticleIds.push(article.id);
    expect(article.pendingVersion.status).toBe("DRAFT");

    const published = await adminService.publishDirect(adminId, article.id);
    expect(published.status).toBe("PUBLISHED");

    const history = await adminService.history(article.id);
    expect(history.map((h) => h.action)).toContain("PUBLISHED_DIRECT");
  });

  it("admin createArticle with publish:true creates and publishes in one step", async () => {
    const article = await adminService.createArticle(adminId, draftPayload(), { publish: true });
    createdArticleIds.push(article.id);
    expect(article.status).toBe("PUBLISHED");
    expect(article.currentPublishedVersionId).not.toBeNull();
  });

  it("editPublished creates a new version and publishes it immediately, superseding the old one", async () => {
    const published = await adminService.createArticle(adminId, draftPayload(), { publish: true });
    createdArticleIds.push(published.id);
    const oldVersionId = published.currentPublishedVersionId;

    const edited = await adminService.editPublished(adminId, published.id, {
      title: published.title,
      summary: "An admin-edited summary.",
      authorName: "Test Author",
      categoryId,
      blocks: [{ blockType: "paragraph", content: { text: "Admin-edited body." } }],
    });

    expect(edited.currentPublishedVersionId).not.toBe(oldVersionId);
    expect(edited.summary).toBe("An admin-edited summary.");
    const oldVersion = await prisma.articleVersion.findUnique({ where: { id: oldVersionId } });
    expect(oldVersion.status).toBe("SUPERSEDED");
  });

  it("editPublished refuses when a revision is already pending", async () => {
    const submitted = await createSubmittedArticle();
    await adminService.approve(adminId, submitted.id);
    await publisherService.revise(publisherId, submitted.id);

    await expect(
      adminService.editPublished(adminId, submitted.id, draftPayload()),
    ).rejects.toMatchObject({ code: "REVISION_IN_PROGRESS" });
  });
});

describe("admin workflow — unpublish / archive (§32)", () => {
  it("PUBLISHED → UNPUBLISHED → ARCHIVED, and each hides the article from the public endpoint", async () => {
    const published = await adminService.createArticle(adminId, draftPayload(), { publish: true });
    createdArticleIds.push(published.id);

    const visible = await articlesService.getPublishedBySlug(published.slug);
    expect(visible.slug).toBe(published.slug);

    const unpublished = await adminService.unpublish(adminId, published.id);
    expect(unpublished.status).toBe("UNPUBLISHED");
    await expect(articlesService.getPublishedBySlug(published.slug)).rejects.toMatchObject({
      statusCode: 404,
    });

    const archived = await adminService.archive(adminId, published.id);
    expect(archived.status).toBe("ARCHIVED");
  });

  it("refuses to unpublish an article that isn't published", async () => {
    const article = await publisherService.createDraft(publisherId, draftPayload());
    createdArticleIds.push(article.id);
    await expect(adminService.unpublish(adminId, article.id)).rejects.toMatchObject({
      code: "NOT_PUBLISHED",
    });
  });
});

describe("admin workflow — delete", () => {
  it("hard-deletes a PUBLISHED article, cascading to its version and comments", async () => {
    const published = await adminService.createArticle(adminId, draftPayload(), {
      publish: true,
    });
    createdArticleIds.push(published.id);
    const versionId = published.currentPublishedVersionId;

    const comment = await commentsService.create(adminId, {
      articleId: published.id,
      content: "A comment that must be cascaded away with the article.",
    });

    await adminService.remove(adminId, published.id);

    await expect(prisma.article.findUnique({ where: { id: published.id } })).resolves.toBeNull();
    await expect(
      prisma.articleVersion.findUnique({ where: { id: versionId } }),
    ).resolves.toBeNull();
    await expect(prisma.comment.findUnique({ where: { id: comment.id } })).resolves.toBeNull();

    // Already gone — nothing left for afterAll to clean up.
    createdArticleIds.splice(createdArticleIds.indexOf(published.id), 1);
  });

  it("404s deleting an article that doesn't exist", async () => {
    await expect(adminService.remove(adminId, randomUUID())).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("admin workflow — magazines", () => {
  it("PHASE 7 DONE-WHEN: publishing a magazine leaves DRAFT/PENDING_REVIEW articles invisible to the public", async () => {
    const published = await adminService.createArticle(
      adminId,
      draftPayload({ title: `Magazine-published ${Date.now()}` }),
      { publish: true },
    );
    const draft = await publisherService.createDraft(
      publisherId,
      draftPayload({ title: `Magazine-draft ${Date.now()}` }),
    );
    const pending = await createSubmittedArticle({ title: `Magazine-pending ${Date.now()}` });
    createdArticleIds.push(published.id, draft.id, pending.id);

    const magazine = await magazinesService.create({
      volumeNumber: 900 + Math.floor(Math.random() * 1000),
      issueNumber: 1,
      title: "Phase 7 test magazine",
    });
    createdMagazineIds.push(magazine.id);

    await magazinesService.attachArticle(magazine.id, {
      articleId: published.id,
      sectionLabel: "Cover Story",
      displayOrder: 1,
    });
    await magazinesService.attachArticle(magazine.id, {
      articleId: draft.id,
      sectionLabel: "Tutorial",
      displayOrder: 2,
    });
    await magazinesService.attachArticle(magazine.id, {
      articleId: pending.id,
      sectionLabel: "News",
      displayOrder: 3,
    });

    const publishedMagazine = await magazinesService.publish(magazine.id);
    expect(publishedMagazine.status).toBe("PUBLISHED");

    // Rule 18: the magazine's own status flip never touches article status.
    const draftAfter = await prisma.article.findUnique({ where: { id: draft.id } });
    const pendingAfter = await prisma.article.findUnique({ where: { id: pending.id } });
    expect(draftAfter.status).toBe("DRAFT");
    expect(pendingAfter.status).toBe("PENDING_REVIEW");

    // And the public API for the now-published magazine shows only the
    // published article — the filtering to PUBLISHED-only lives in the
    // serializer (context doc §21), same as the real HTTP response, so this
    // goes through it rather than the raw (unfiltered) service return value.
    const rawMagazine = await archiveService.getPublishedBySlug(magazine.slug);
    const publicMagazine = serializeMagazineDetail(rawMagazine);
    const slugsShown = publicMagazine.contents.map((entry) => entry.article.slug);
    expect(slugsShown).toContain(published.slug);
    expect(slugsShown).not.toContain(draft.slug);
    expect(slugsShown).not.toContain(pending.slug);
  });

  it("cannot delete a magazine that still has articles attached", async () => {
    const article = await adminService.createArticle(adminId, draftPayload(), { publish: true });
    createdArticleIds.push(article.id);
    const magazine = await magazinesService.create({
      volumeNumber: 900 + Math.floor(Math.random() * 1000),
      issueNumber: 2,
      title: "Non-deletable magazine",
    });
    createdMagazineIds.push(magazine.id);
    await magazinesService.attachArticle(magazine.id, { articleId: article.id, displayOrder: 1 });

    await expect(magazinesService.remove(magazine.id)).rejects.toMatchObject({
      code: "MAGAZINE_HAS_ARTICLES",
    });
  });

  it("reorders attached articles atomically", async () => {
    const a = await adminService.createArticle(adminId, draftPayload(), { publish: true });
    const b = await adminService.createArticle(adminId, draftPayload(), { publish: true });
    createdArticleIds.push(a.id, b.id);
    const magazine = await magazinesService.create({
      volumeNumber: 900 + Math.floor(Math.random() * 1000),
      issueNumber: 3,
      title: "Reorder test magazine",
    });
    createdMagazineIds.push(magazine.id);
    await magazinesService.attachArticle(magazine.id, { articleId: a.id, displayOrder: 1 });
    await magazinesService.attachArticle(magazine.id, { articleId: b.id, displayOrder: 2 });

    const reordered = await magazinesService.reorderArticles(magazine.id, [
      { articleId: a.id, displayOrder: 2 },
      { articleId: b.id, displayOrder: 1 },
    ]);
    const orderMap = Object.fromEntries(
      reordered.articles.map((entry) => [entry.articleId, entry.displayOrder]),
    );
    expect(orderMap[a.id]).toBe(2);
    expect(orderMap[b.id]).toBe(1);
  });
});

describe("admin workflow — user administration", () => {
  it("promotes a USER to PUBLISHER — the only way that role change happens", async () => {
    const target = await prisma.user.create({
      data: {
        name: "Promotion target",
        email: `phase7-promote-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: await hashPassword("Test-Password-123"),
        role: "USER",
        emailVerified: true,
      },
    });
    createdUserIds.push(target.id);

    const promoted = await usersService.adminUpdate(adminId, target.id, { role: "PUBLISHER" });
    expect(promoted.role).toBe("PUBLISHER");
  });

  it("refuses to let an admin demote themselves", async () => {
    await expect(
      usersService.adminUpdate(adminId, adminId, { role: "USER" }),
    ).rejects.toMatchObject({ code: "CANNOT_SELF_DEMOTE" });
  });

  it("refuses to let an admin deactivate themselves", async () => {
    await expect(
      usersService.adminUpdate(adminId, adminId, { isActive: false }),
    ).rejects.toMatchObject({ code: "CANNOT_SELF_DEACTIVATE" });
  });

  it("deactivating a user revokes their active sessions", async () => {
    const target = await prisma.user.create({
      data: {
        name: "Deactivation target",
        email: `phase7-deactivate-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: await hashPassword("Test-Password-123"),
        role: "USER",
        emailVerified: true,
      },
    });
    createdUserIds.push(target.id);
    await prisma.refreshToken.create({
      data: {
        userId: target.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await usersService.adminUpdate(adminId, target.id, { isActive: false });

    const tokens = await prisma.refreshToken.findMany({ where: { userId: target.id } });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });
});
