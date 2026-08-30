/**
 * Every other integration test in this suite calls service functions
 * directly — which correctly tests business logic, but never exercises the
 * actual HTTP/middleware stack (requireAuth, requireRole, validate). That
 * leaves §45 rule 28 ("Backend authorization does not rely on frontend role
 * checks") with no real proof: a route wired without its role guard would
 * pass every other test in this suite and only fail here.
 *
 * This file hits the real Express app through supertest — same requireAuth/
 * requireRole middleware a real client would go through, no server process
 * needed (app.js is exported specifically so tests can do this).
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
import * as publisherService from "../../src/modules/publisher/publisher.service.js";
import * as commentsService from "../../src/modules/comments/comments.service.js";

let adminUser;
let publisherUser;
let otherPublisherUser;
let plainUser;
let adminToken;
let publisherToken;
let userToken;
let categoryId;
let pendingArticle; // owned by publisherUser, submitted and awaiting review
let publishedArticle;
let otherPublishersDraft; // owned by otherPublisherUser
const createdArticleIds = [];
const createdUserIds = [];
const createdCommentIds = [];

function tokenFor(user) {
  return signAccessToken({ sub: user.id, role: user.role });
}

beforeAll(async () => {
  const category = await prisma.category.findFirst();
  if (!category) throw new Error("Seed data required — run `npm run seed` before the test suite");
  categoryId = category.id;

  const passwordHash = await hashPassword("Test-Password-123");
  const suffix = randomUUID().slice(0, 8);
  [adminUser, publisherUser, otherPublisherUser, plainUser] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Phase 11 Admin",
        email: `phase11-admin-${suffix}@example.com`,
        passwordHash,
        role: "ADMIN",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "Phase 11 Publisher A",
        email: `phase11-pub-a-${suffix}@example.com`,
        passwordHash,
        role: "PUBLISHER",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "Phase 11 Publisher B",
        email: `phase11-pub-b-${suffix}@example.com`,
        passwordHash,
        role: "PUBLISHER",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "Phase 11 Plain User",
        email: `phase11-user-${suffix}@example.com`,
        passwordHash,
        role: "USER",
        emailVerified: true,
      },
    }),
  ]);
  createdUserIds.push(adminUser.id, publisherUser.id, otherPublisherUser.id, plainUser.id);
  adminToken = tokenFor(adminUser);
  publisherToken = tokenFor(publisherUser);
  userToken = tokenFor(plainUser);

  const draft = await publisherService.createDraft(publisherUser.id, {
    title: `Phase 11 pending article ${Date.now()}`,
    summary: "For the authorization test suite.",
    authorName: "Test Author",
    categoryId,
    blocks: [{ blockType: "paragraph", content: { text: "Body." } }],
  });
  createdArticleIds.push(draft.id);
  pendingArticle = await publisherService.submit(publisherUser.id, draft.id);

  publishedArticle = await adminService.createArticle(
    adminUser.id,
    {
      title: `Phase 11 published article ${Date.now()}`,
      summary: "For the authorization test suite.",
      authorName: "Test Author",
      categoryId,
      blocks: [{ blockType: "paragraph", content: { text: "Body." } }],
    },
    { publish: true },
  );
  createdArticleIds.push(publishedArticle.id);

  otherPublishersDraft = await publisherService.createDraft(otherPublisherUser.id, {
    title: `Phase 11 other publisher's draft ${Date.now()}`,
    summary: "Owned by publisher B.",
    authorName: "Test Author",
    categoryId,
    blocks: [],
  });
  createdArticleIds.push(otherPublishersDraft.id);
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

describe("authorization — no token means no access (every protected surface)", () => {
  it.each([
    ["GET", "/api/admin/articles"],
    ["GET", "/api/admin/reviews"],
    ["GET", "/api/admin/magazines"],
    ["GET", "/api/admin/users"],
    ["GET", "/api/admin/media"],
    ["GET", "/api/publisher/articles"],
    ["GET", "/api/me"],
    ["GET", "/api/me/notifications"],
  ])("%s %s → 401 with no Authorization header", async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path);
    expect(res.status).toBe(401);
  });
});

describe("authorization — §45 rule 10 / checklist #1: Publisher cannot publish directly", () => {
  it("PUBLISHER gets 403 approving a submission — that's an ADMIN-only route", async () => {
    const res = await request(app)
      .post(`/api/admin/articles/${pendingArticle.id}/approve`)
      .set("Authorization", `Bearer ${publisherToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("PUBLISHER gets 403 publishing directly — no such capability exists for that role", async () => {
    const res = await request(app)
      .post(`/api/admin/articles/${pendingArticle.id}/publish`)
      .set("Authorization", `Bearer ${publisherToken}`);
    expect(res.status).toBe(403);
  });

  it("PUBLISHER gets 403 on every other admin article-workflow route too", async () => {
    const attempts = [
      request(app)
        .post(`/api/admin/articles/${pendingArticle.id}/reject`)
        .set("Authorization", `Bearer ${publisherToken}`)
        .send({ reason: "x" }),
      request(app)
        .post(`/api/admin/articles/${publishedArticle.id}/unpublish`)
        .set("Authorization", `Bearer ${publisherToken}`),
      request(app)
        .post(`/api/admin/articles`)
        .set("Authorization", `Bearer ${publisherToken}`)
        .send({}),
    ];
    const results = await Promise.all(attempts);
    expect(results.every((r) => r.status === 403)).toBe(true);
  });

  it("§45 rule 11: ADMIN, unlike PUBLISHER, can use the exact same approve route successfully", async () => {
    const res = await request(app)
      .post(`/api/admin/articles/${pendingArticle.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PUBLISHED");
  });
});

describe("authorization — USER cannot reach publisher or admin surfaces", () => {
  it("USER gets 403 on the publisher article list", async () => {
    const res = await request(app)
      .get("/api/publisher/articles")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it("USER gets 403 on the admin article list", async () => {
    const res = await request(app)
      .get("/api/admin/articles")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});

describe("authorization — admin article hard-delete is ADMIN-only", () => {
  it("PUBLISHER gets 403 deleting an article via the admin route; the article survives", async () => {
    const res = await request(app)
      .delete(`/api/admin/articles/${publishedArticle.id}`)
      .set("Authorization", `Bearer ${publisherToken}`);
    expect(res.status).toBe(403);

    const stillThere = await prisma.article.findUnique({ where: { id: publishedArticle.id } });
    expect(stillThere).not.toBeNull();
  });

  it("USER gets 403 deleting an article via the admin route; the article survives", async () => {
    const res = await request(app)
      .delete(`/api/admin/articles/${publishedArticle.id}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);

    const stillThere = await prisma.article.findUnique({ where: { id: publishedArticle.id } });
    expect(stillThere).not.toBeNull();
  });
});

describe("authorization — §45 rule 29: publisher ownership is enforced server-side, over real HTTP", () => {
  it("publisher B gets 404 (not 403) fetching publisher A's own draft via the real route", async () => {
    const res = await request(app)
      .get(`/api/publisher/articles/${otherPublishersDraft.id}`)
      .set("Authorization", `Bearer ${publisherToken}`); // publisherUser (A) trying B's article
    expect(res.status).toBe(404);
  });
});

describe("authorization — §45 rules 1, 2: only USER/PUBLISHER/ADMIN are valid roles", () => {
  it("PATCH /api/admin/users/:id rejects an invalid role string like GUEST", async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${plainUser.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "GUEST" });
    expect(res.status).toBe(422);
  });
});

describe("authorization — §45 rule 22: comment deletion", () => {
  it("a non-owner USER gets 403 deleting someone else's comment; ADMIN can delete it (204)", async () => {
    const comment = await commentsService.create(plainUser.id, {
      articleId: publishedArticle.id,
      content: "For the HTTP authorization test.",
    });
    createdCommentIds.push(comment.id);

    const forbidden = await request(app)
      .delete(`/api/comments/${comment.id}`)
      .set("Authorization", `Bearer ${publisherToken}`); // not the author, not admin
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .delete(`/api/comments/${comment.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(allowed.status).toBe(204);
  });
});
