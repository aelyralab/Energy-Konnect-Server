/**
 * Hits the live database directly through the service layer — no HTTP, no
 * mocks. Verifies Phase 6's explicit "done when" bar:
 *   1. While a revision is pending, the public endpoint still serves the old
 *      published version in full.
 *   2. Publisher B gets 404 on publisher A's article at every endpoint.
 * Plus the surrounding workflow rules (submit gate, withdraw, resubmit,
 * revise preconditions, delete guard) that make those two bars meaningful.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "../../src/config/db.js";
import { retireTestUsers } from "../helpers/users.js";
import { hashPassword } from "../../src/utils/password.js";
import * as publisherService from "../../src/modules/publisher/publisher.service.js";
import * as articlesService from "../../src/modules/articles/articles.service.js";

let publisherAId;
let publisherBId;
let categoryId;
const createdArticleIds = [];
const createdUserIds = [];

beforeAll(async () => {
  const category = await prisma.category.findFirst();
  if (!category) throw new Error("Seed data required — run `npm run seed` before the test suite");
  categoryId = category.id;

  const passwordHash = await hashPassword("Test-Password-123");
  const suffix = randomUUID().slice(0, 8);
  const [pubA, pubB] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Phase 6 Publisher A",
        email: `phase6-pub-a-${suffix}@example.com`,
        passwordHash,
        role: "PUBLISHER",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "Phase 6 Publisher B",
        email: `phase6-pub-b-${suffix}@example.com`,
        passwordHash,
        role: "PUBLISHER",
        emailVerified: true,
      },
    }),
  ]);
  publisherAId = pubA.id;
  publisherBId = pubB.id;
  createdUserIds.push(pubA.id, pubB.id);
});

afterAll(async () => {
  if (createdArticleIds.length > 0) {
    await prisma.article.deleteMany({ where: { id: { in: createdArticleIds } } });
  }
  if (createdUserIds.length > 0) {
    await retireTestUsers(createdUserIds);
  }
});

function draftPayload(overrides = {}) {
  return {
    title: `Phase 6 draft ${Date.now()}-${Math.random().toString(36).slice(2)}`,
    summary: "A throwaway article for the publisher workflow test suite.",
    authorName: "Test Author",
    categoryId,
    blocks: [{ blockType: "paragraph", content: { text: "Body text." } }],
    ...overrides,
  };
}

/** Directly promotes a from-scratch draft to PUBLISHED, bypassing the admin
 * approve flow (Phase 7, not built yet) — this test only needs the *result*
 * of an approval (a live published version) to exercise revise(). */
async function forcePublish(articleId, versionId) {
  await prisma.$transaction([
    prisma.articleVersion.update({ where: { id: versionId }, data: { status: "PUBLISHED" } }),
    prisma.article.update({
      where: { id: articleId },
      data: {
        status: "PUBLISHED",
        currentPublishedVersionId: versionId,
        pendingVersionId: null,
        publishedAt: new Date(),
      },
    }),
  ]);
}

describe("publisher workflow — draft → submit → withdraw → resubmit", () => {
  it("creates a draft with DRAFT status and an editable pending version", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(article.id);

    expect(article.status).toBe("DRAFT");
    expect(article.pendingVersion.status).toBe("DRAFT");
    expect(article.pendingVersion.versionNumber).toBe(1);
  });

  it("refuses to submit until the §26 required fields are all present", async () => {
    const article = await publisherService.createDraft(
      publisherAId,
      draftPayload({ summary: undefined, blocks: [] }),
    );
    createdArticleIds.push(article.id);

    await expect(publisherService.submit(publisherAId, article.id)).rejects.toMatchObject({
      code: "SUBMIT_REQUIREMENTS_NOT_MET",
    });
  });

  it("submit moves DRAFT → PENDING_REVIEW on both the article and its version, and logs SUBMITTED", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(article.id);

    const submitted = await publisherService.submit(publisherAId, article.id);
    expect(submitted.status).toBe("PENDING_REVIEW");
    expect(submitted.pendingVersion.status).toBe("PENDING_REVIEW");

    const history = await publisherService.history(publisherAId, article.id);
    expect(history.map((h) => h.action)).toContain("SUBMITTED");
  });

  it("a submitted (PENDING_REVIEW) version cannot be edited until withdrawn", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(article.id);
    await publisherService.submit(publisherAId, article.id);

    await expect(
      publisherService.updateDraft(publisherAId, article.id, draftPayload({ title: "New title" })),
    ).rejects.toMatchObject({ code: "VERSION_NOT_EDITABLE" });
  });

  it("withdraw returns PENDING_REVIEW to DRAFT and re-opens it for editing", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(article.id);
    await publisherService.submit(publisherAId, article.id);

    const withdrawn = await publisherService.withdraw(publisherAId, article.id);
    expect(withdrawn.status).toBe("DRAFT");
    expect(withdrawn.pendingVersion.status).toBe("DRAFT");

    // Now editable again.
    const edited = await publisherService.updateDraft(
      publisherAId,
      article.id,
      draftPayload({ title: "Edited after withdraw" }),
    );
    expect(edited.pendingVersion.title).toBe("Edited after withdraw");
  });

  it("a REJECTED version can be resubmitted", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(article.id);
    const submitted = await publisherService.submit(publisherAId, article.id);

    // Simulate an admin rejection (Phase 7 builds the real endpoint).
    await prisma.articleVersion.update({
      where: { id: submitted.pendingVersion.id },
      data: { status: "REJECTED" },
    });
    await prisma.article.update({ where: { id: article.id }, data: { status: "REJECTED" } });

    const resubmitted = await publisherService.submit(publisherAId, article.id);
    expect(resubmitted.status).toBe("PENDING_REVIEW");
    expect(resubmitted.pendingVersion.status).toBe("PENDING_REVIEW");
  });
});

describe("publisher workflow — delete", () => {
  it("deletes a never-published draft", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    await publisherService.removeDraft(publisherAId, article.id);

    const found = await prisma.article.findUnique({ where: { id: article.id } });
    expect(found).toBeNull();
  });

  it("refuses to delete a submitted (PENDING_REVIEW) article", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(article.id);
    await publisherService.submit(publisherAId, article.id);

    await expect(publisherService.removeDraft(publisherAId, article.id)).rejects.toMatchObject({
      code: "ARTICLE_NOT_DELETABLE",
    });
  });
});

describe("publisher workflow — revise (§29) and the public-serving guarantee", () => {
  it("revise requires the article to already be published", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(article.id);

    await expect(publisherService.revise(publisherAId, article.id)).rejects.toMatchObject({
      code: "NOT_PUBLISHED",
    });
  });

  it("revise copies metadata and blocks into a new pending version without touching the live one", async () => {
    const created = await publisherService.createDraft(
      publisherAId,
      draftPayload({ blocks: [{ blockType: "paragraph", content: { text: "Original body." } }] }),
    );
    createdArticleIds.push(created.id);
    await forcePublish(created.id, created.pendingVersion.id);

    const revised = await publisherService.revise(publisherAId, created.id);
    expect(revised.pendingVersion.versionNumber).toBe(2);
    expect(revised.pendingVersion.status).toBe("DRAFT");
    // Raw Prisma shape from the service layer — `content`, not the
    // HTTP-serialized `data` the controller's serializer produces.
    expect(revised.pendingVersion.blocks[0].content).toEqual({ text: "Original body." });
    // The published pointer is untouched — still version 1.
    expect(revised.currentPublishedVersion.versionNumber).toBe(1);
  });

  it("refuses a second revise while one is already in progress", async () => {
    const created = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(created.id);
    await forcePublish(created.id, created.pendingVersion.id);
    await publisherService.revise(publisherAId, created.id);

    await expect(publisherService.revise(publisherAId, created.id)).rejects.toMatchObject({
      code: "REVISION_IN_PROGRESS",
    });
  });

  it("PHASE 6 DONE-WHEN: the public endpoint still serves the old version in full while a revision is pending", async () => {
    const created = await publisherService.createDraft(
      publisherAId,
      draftPayload({
        title: `Phase 6 public-serving test ${Date.now()}`,
        blocks: [
          { blockType: "paragraph", content: { text: "The version the public should see." } },
        ],
      }),
    );
    createdArticleIds.push(created.id);
    await forcePublish(created.id, created.pendingVersion.id);

    // Edit the revision to something visibly different from what's public.
    await publisherService.revise(publisherAId, created.id);
    await publisherService.updateDraft(publisherAId, created.id, {
      title: created.title,
      summary: "A completely different, unreviewed summary.",
      authorName: "Test Author",
      categoryId,
      blocks: [
        { blockType: "paragraph", content: { text: "UNREVIEWED content — must never be public." } },
      ],
    });

    const publicView = await articlesService.getPublishedBySlug(created.slug);
    expect(publicView.summary).not.toBe("A completely different, unreviewed summary.");
    expect(publicView.currentPublishedVersion.blocks[0].content.text).toBe(
      "The version the public should see.",
    );
    expect(
      publicView.currentPublishedVersion.blocks.some(
        (b) => b.content.text === "UNREVIEWED content — must never be public.",
      ),
    ).toBe(false);
  });
});

describe("publisher workflow — ownership (§45 rule 29)", () => {
  it("PHASE 6 DONE-WHEN: publisher B gets 404 on publisher A's article at every endpoint", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(article.id);
    await forcePublish(article.id, article.pendingVersion.id);
    // Give A's article an in-progress revision too, so revise() has
    // something to 404 on before B could even reach the "already in
    // progress" business-rule error.
    await publisherService.revise(publisherAId, article.id);

    const attempts = [
      () => publisherService.getOwn(publisherBId, article.id),
      () =>
        publisherService.updateDraft(publisherBId, article.id, draftPayload({ title: "Hijacked" })),
      () => publisherService.submit(publisherBId, article.id),
      () => publisherService.withdraw(publisherBId, article.id),
      () => publisherService.revise(publisherBId, article.id),
      () => publisherService.removeDraft(publisherBId, article.id),
      () => publisherService.history(publisherBId, article.id),
    ];

    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ statusCode: 404 });
    }

    // And A's article is provably untouched by any of B's attempts.
    const stillOwnedByA = await prisma.article.findUnique({ where: { id: article.id } });
    expect(stillOwnedByA.publisherId).toBe(publisherAId);
    expect(stillOwnedByA.title).not.toBe("Hijacked");
  });

  it("publisher B's own article list never includes publisher A's articles", async () => {
    const article = await publisherService.createDraft(publisherAId, draftPayload());
    createdArticleIds.push(article.id);

    const { items } = await publisherService.listOwn(publisherBId, { page: 1, limit: 50 });
    expect(items.some((item) => item.id === article.id)).toBe(false);
  });

  it("the list carries pagination metadata (page/limit), not just items and total", async () => {
    const result = await publisherService.listOwn(publisherAId, { page: 1, limit: 50 });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(typeof result.total).toBe("number");
  });
});
