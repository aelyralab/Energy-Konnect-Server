/**
 * Phase 11: closes the remaining gaps in §45 rule coverage — the
 * structural/architectural rules that don't naturally live inside any one
 * phase's own workflow tests (they're either "this thing has no code path
 * at all" or "the schema itself enforces this"), plus one route existence
 * check via supertest. See IMPLEMENTATION_PLAN.md's §45 coverage table for
 * the full rule → test mapping across every file in this suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import app from "../../src/app.js";
import prisma from "../../src/config/db.js";
import { retireTestUsers } from "../helpers/users.js";
import { hashPassword } from "../../src/utils/password.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import * as adminService from "../../src/modules/admin/admin.service.js";
import * as commentsService from "../../src/modules/comments/comments.service.js";

let adminId;
let adminToken;
let categoryId;
let publishedArticle;
const createdArticleIds = [];
const createdUserIds = [];
const createdCommentIds = [];

beforeAll(async () => {
  const category = await prisma.category.findFirst();
  if (!category) throw new Error("Seed data required — run `npm run seed` before the test suite");
  categoryId = category.id;

  const admin = await prisma.user.create({
    data: {
      name: "Phase 11 Rules Admin",
      email: `phase11-rules-admin-${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: await hashPassword("Test-Password-123"),
      role: "ADMIN",
      emailVerified: true,
    },
  });
  adminId = admin.id;
  adminToken = signAccessToken({ sub: admin.id, role: admin.role });
  createdUserIds.push(admin.id);

  publishedArticle = await adminService.createArticle(
    adminId,
    {
      title: `Phase 11 rules article ${Date.now()}`,
      summary: "For the business rules test suite.",
      authorName: "Someone Who Has No User Account At All",
      categoryId,
      blocks: [],
    },
    { publish: true },
  );
  createdArticleIds.push(publishedArticle.id);
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

describe("§45 rules 1, 2: Guest is not a role; only USER/PUBLISHER/ADMIN exist", () => {
  it("the database itself refuses a role value outside the enum — not just application validation", async () => {
    await expect(
      prisma.user.create({
        data: {
          name: "Invalid Role Attempt",
          email: `phase11-badrole-${randomUUID().slice(0, 8)}@example.com`,
          passwordHash: "irrelevant",
          role: "GUEST",
        },
      }),
    ).rejects.toBeTruthy();
  });
});

describe("§45 rule 4: password reset is not part of V1", () => {
  it("no reset-password or forgot-password route exists", async () => {
    const reset = await request(app).post("/api/auth/reset-password").send({});
    expect(reset.status).toBe(404);
    const forgot = await request(app).post("/api/auth/forgot-password").send({});
    expect(forgot.status).toBe(404);
  });
});

describe("§45 rule 5: author is plain article metadata, not a linked account", () => {
  it("authorName is free text with no corresponding User row required", async () => {
    expect(publishedArticle.authorName).toBe("Someone Who Has No User Account At All");
    const matchingUser = await prisma.user.findFirst({
      where: { name: "Someone Who Has No User Account At All" },
    });
    expect(matchingUser).toBeNull();
  });
});

describe("§45 rule 6: category is a single primary classification", () => {
  it("an article has exactly one categoryId — a scalar reference, not a collection", async () => {
    expect(typeof publishedArticle.categoryId).toBe("string");
    expect(Array.isArray(publishedArticle.categoryId)).toBe(false);
  });
});

describe("§45 rules 7, 8: topic is secondary/multiple, tag is flexible/multiple", () => {
  it("an article can carry more than one topic and more than one tag at once", async () => {
    const topics = await prisma.topic.findMany({ take: 2 });
    const tags = await prisma.tag.findMany({ take: 2 });
    expect(topics.length).toBeGreaterThanOrEqual(2);
    expect(tags.length).toBeGreaterThanOrEqual(2);

    const article = await adminService.createArticle(
      adminId,
      {
        title: `Phase 11 multi-taxonomy article ${Date.now()}`,
        summary: "For the topic/tag multiplicity test.",
        authorName: "Test Author",
        categoryId,
        blocks: [],
        topicIds: topics.map((t) => t.id),
        tagIds: tags.map((t) => t.id),
      },
      { publish: false },
    );
    createdArticleIds.push(article.id);

    expect(article.topics).toHaveLength(2);
    expect(article.tags).toHaveLength(2);
  });
});

describe("§45 rule 20: comments are single-level — there is no reply/parent concept", () => {
  it("a submitted parentCommentId is silently ignored, not stored — the field doesn't exist", async () => {
    const comment = await commentsService.create(adminId, {
      articleId: publishedArticle.id,
      content: "Top-level only, always.",
      parentCommentId: "should-be-ignored-entirely",
    });
    createdCommentIds.push(comment.id);
    expect(comment.parentCommentId).toBeUndefined();
  });
});

describe("§45 rule 21: comment reporting/flagging is not in V1", () => {
  it("no report/flag route exists for a comment", async () => {
    const comment = await commentsService.create(adminId, {
      articleId: publishedArticle.id,
      content: "For the no-reporting-route test.",
    });
    createdCommentIds.push(comment.id);

    // Authenticated so the request actually reaches route matching —
    // comments.routes.js applies requireAuth router-wide via router.use(),
    // so an unauthenticated request 401s on any unmatched sub-path before
    // Express ever gets to decide the route doesn't exist.
    const res = await request(app)
      .post(`/api/comments/${comment.id}/report`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe("§45 rule 23 (reinforced): the database itself refuses to delete a user with comments", () => {
  it("deleting a commenting user's row directly violates the FK — deactivation is the only path", async () => {
    const commenter = await prisma.user.create({
      data: {
        name: "Phase 11 FK Test Commenter",
        email: `phase11-fk-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: await hashPassword("Test-Password-123"),
        role: "USER",
        emailVerified: true,
      },
    });
    const comment = await commentsService.create(commenter.id, {
      articleId: publishedArticle.id,
      content: "This comment blocks its author's deletion.",
    });

    await expect(prisma.user.delete({ where: { id: commenter.id } })).rejects.toBeTruthy();

    // Clean up in the order the FK actually allows.
    await prisma.comment.delete({ where: { id: comment.id } });
    await prisma.user.delete({ where: { id: commenter.id } });
  });
});
