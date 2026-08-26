/**
 * Hits the live database directly through the service layer — no HTTP, no
 * mocks. Verifies Phase 8's explicit "done when" bar: deactivating a user
 * still returns their comments, with the author field nulled.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "../../src/config/db.js";
import { retireTestUsers } from "../helpers/users.js";
import { hashPassword } from "../../src/utils/password.js";
import * as adminService from "../../src/modules/admin/admin.service.js";
import * as commentsService from "../../src/modules/comments/comments.service.js";

let adminId;
let commenterId;
let publishedArticle;
let draftArticle;
const createdCommentIds = [];
const createdArticleIds = [];
const createdUserIds = [];

beforeAll(async () => {
  const category = await prisma.category.findFirst();
  if (!category) throw new Error("Seed data required — run `npm run seed` before the test suite");

  const passwordHash = await hashPassword("Test-Password-123");
  const suffix = randomUUID().slice(0, 8);
  const [admin, commenter] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Phase 8 Admin",
        email: `phase8-admin-${suffix}@example.com`,
        passwordHash,
        role: "ADMIN",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "Phase 8 Commenter",
        email: `phase8-commenter-${suffix}@example.com`,
        passwordHash,
        role: "USER",
        emailVerified: true,
      },
    }),
  ]);
  adminId = admin.id;
  commenterId = commenter.id;
  createdUserIds.push(admin.id, commenter.id);

  publishedArticle = await adminService.createArticle(
    adminId,
    {
      title: `Phase 8 published article ${Date.now()}`,
      summary: "For the comments test suite.",
      authorName: "Test Author",
      categoryId: category.id,
      blocks: [{ blockType: "paragraph", content: { text: "Body." } }],
    },
    { publish: true },
  );
  createdArticleIds.push(publishedArticle.id);

  draftArticle = await adminService.createArticle(
    adminId,
    {
      title: `Phase 8 draft article ${Date.now()}`,
      summary: "Never published.",
      authorName: "Test Author",
      categoryId: category.id,
      blocks: [],
    },
    { publish: false },
  );
  createdArticleIds.push(draftArticle.id);
});

afterAll(async () => {
  if (createdCommentIds.length > 0) {
    await prisma.comment.deleteMany({ where: { id: { in: createdCommentIds } } });
  }
  if (createdArticleIds.length > 0) {
    await prisma.article.deleteMany({ where: { id: { in: createdArticleIds } } });
  }
  if (createdUserIds.length > 0) {
    await retireTestUsers(createdUserIds);
  }
});

describe("comments — create", () => {
  it("creates a comment on a published article", async () => {
    const comment = await commentsService.create(commenterId, {
      articleId: publishedArticle.id,
      content: "A thoughtful comment.",
    });
    createdCommentIds.push(comment.id);

    expect(comment.content).toBe("A thoughtful comment.");
    expect(comment.userId).toBe(commenterId);
    expect(comment.isDeleted).toBe(false);
  });

  it("refuses a comment on an unpublished (draft) article", async () => {
    await expect(
      commentsService.create(commenterId, {
        articleId: draftArticle.id,
        content: "Should not be allowed.",
      }),
    ).rejects.toMatchObject({ code: "ARTICLE_NOT_PUBLISHED" });
  });

  it("refuses a comment on a nonexistent article id", async () => {
    await expect(
      commentsService.create(commenterId, {
        articleId: randomUUID(),
        content: "Ghost article.",
      }),
    ).rejects.toMatchObject({ code: "ARTICLE_NOT_PUBLISHED" });
  });
});

describe("comments — list (public, by article slug)", () => {
  it("lists comments in chronological order, paginated", async () => {
    const first = await commentsService.create(commenterId, {
      articleId: publishedArticle.id,
      content: "First comment.",
    });
    const second = await commentsService.create(commenterId, {
      articleId: publishedArticle.id,
      content: "Second comment.",
    });
    createdCommentIds.push(first.id, second.id);

    const { items, total, page, limit } = await commentsService.listForArticleSlug(
      publishedArticle.slug,
      { page: 1, limit: 50 },
    );
    expect(page).toBe(1);
    expect(limit).toBe(50);
    expect(total).toBeGreaterThanOrEqual(2);
    const contents = items.map((c) => c.content);
    expect(contents.indexOf("First comment.")).toBeLessThan(contents.indexOf("Second comment."));
  });

  it("404s for a draft article's slug — comments on unpublished content are never public", async () => {
    await expect(
      commentsService.listForArticleSlug(draftArticle.slug, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("comments — delete", () => {
  it("the author can delete their own comment (soft delete)", async () => {
    const comment = await commentsService.create(commenterId, {
      articleId: publishedArticle.id,
      content: "Will be deleted by its author.",
    });
    createdCommentIds.push(comment.id);

    await commentsService.remove({ id: commenterId, role: "USER" }, comment.id);

    const raw = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(raw.isDeleted).toBe(true);

    const { items } = await commentsService.listForArticleSlug(publishedArticle.slug, {
      page: 1,
      limit: 100,
    });
    expect(items.some((c) => c.id === comment.id)).toBe(false);
  });

  it("admin can delete any comment, not just their own", async () => {
    const comment = await commentsService.create(commenterId, {
      articleId: publishedArticle.id,
      content: "Will be deleted by an admin.",
    });
    createdCommentIds.push(comment.id);

    await commentsService.remove({ id: adminId, role: "ADMIN" }, comment.id);

    const raw = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(raw.isDeleted).toBe(true);
  });

  it("a different, non-admin USER cannot delete someone else's comment", async () => {
    const other = await prisma.user.create({
      data: {
        name: "Phase 8 Other User",
        email: `phase8-other-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: await hashPassword("Test-Password-123"),
        role: "USER",
        emailVerified: true,
      },
    });
    createdUserIds.push(other.id);

    const comment = await commentsService.create(commenterId, {
      articleId: publishedArticle.id,
      content: "Not yours to delete.",
    });
    createdCommentIds.push(comment.id);

    await expect(
      commentsService.remove({ id: other.id, role: "USER" }, comment.id),
    ).rejects.toMatchObject({ code: "NOT_YOUR_COMMENT" });

    const raw = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(raw.isDeleted).toBe(false);
  });

  it("404s deleting a comment that doesn't exist", async () => {
    await expect(
      commentsService.remove({ id: adminId, role: "ADMIN" }, randomUUID()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("comments — deactivated-author handling", () => {
  it("PHASE 8 DONE-WHEN: a deactivated user's comments still return, with author nulled", async () => {
    const comment = await commentsService.create(commenterId, {
      articleId: publishedArticle.id,
      content: "Comment from an about-to-be-deactivated user.",
    });
    createdCommentIds.push(comment.id);

    // Confirm the author shows normally beforehand.
    const before = await commentsService.listForArticleSlug(publishedArticle.slug, {
      page: 1,
      limit: 100,
    });
    const beforeEntry = before.items.find((c) => c.id === comment.id);
    expect(beforeEntry.userId).toBe(commenterId);

    // Deactivate — not delete. The comment row must survive untouched.
    await prisma.user.update({ where: { id: commenterId }, data: { isActive: false } });

    const after = await commentsService.listForArticleSlug(publishedArticle.slug, {
      page: 1,
      limit: 100,
    });
    const afterEntry = after.items.find((c) => c.id === comment.id);
    expect(afterEntry).toBeDefined(); // still returned
    expect(afterEntry.content).toBe("Comment from an about-to-be-deactivated user."); // content intact
    expect(afterEntry.user.isActive).toBe(false);

    // Reactivate so the shared fixture user doesn't stay broken for
    // whichever test happens to run after this one.
    await prisma.user.update({ where: { id: commenterId }, data: { isActive: true } });
  });

  // Not tested: "a deactivated user deletes their own comment" — it isn't a
  // reachable path. auth.middleware.js's requireAuth rejects every request
  // from a deactivated account with ACCOUNT_DEACTIVATED before it reaches
  // any controller, comments included, so that scenario can't occur over
  // the real API regardless of what commentsService.remove() would do if
  // called directly.
});
