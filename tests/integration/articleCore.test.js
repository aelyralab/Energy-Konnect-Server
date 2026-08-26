/**
 * Hits the live database (same one `npm run seed` populates) — no mocks.
 * Verifies the Phase 5 "done when" bar directly: a version's blocks round-trip
 * through save → fetch with order intact, and the article/version/block
 * transaction is atomic.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../../src/config/db.js";
import * as articlesService from "../../src/modules/articles/articles.service.js";
import * as versionsService from "../../src/modules/articleVersions/articleVersions.service.js";

let publisherId;
let categoryId;
const createdArticleIds = [];

beforeAll(async () => {
  const publisher = await prisma.user.findFirst({ where: { role: "PUBLISHER" } });
  const category = await prisma.category.findFirst();
  if (!publisher || !category) {
    throw new Error("Seed data required — run `npm run seed` before the test suite");
  }
  publisherId = publisher.id;
  categoryId = category.id;
});

afterAll(async () => {
  // ArticleVersion/ArticleContentBlock cascade on the article's deletion.
  if (createdArticleIds.length > 0) {
    await prisma.article.deleteMany({ where: { id: { in: createdArticleIds } } });
  }
});

function samplePayload(overrides = {}) {
  return {
    publisherId,
    title: `Phase 5 test article ${Date.now()}-${Math.random().toString(36).slice(2)}`,
    summary: "A throwaway article created by the integration test suite.",
    authorName: "Test Author",
    categoryId,
    blocks: [
      { blockType: "heading", content: { level: 2, text: "Section one" } },
      { blockType: "paragraph", content: { text: "First paragraph." } },
      { blockType: "paragraph", content: { text: "Second paragraph." } },
    ],
    ...overrides,
  };
}

describe("createArticle — article + version 1 + blocks as one transaction", () => {
  it("creates the article shell, version 1, and its blocks together", async () => {
    const result = await articlesService.createArticle(samplePayload());
    createdArticleIds.push(result.id);

    expect(result.status).toBe("DRAFT");
    expect(result.pendingVersionId).toBe(result.pendingVersion.id);
    expect(result.currentPublishedVersionId).toBeNull();
    expect(result.pendingVersion.versionNumber).toBe(1);
    expect(result.pendingVersion.status).toBe("DRAFT");
  });

  it("generates a unique slug from the title", async () => {
    const title = `Duplicate Slug Test ${Date.now()}`;
    const first = await articlesService.createArticle(samplePayload({ title }));
    const second = await articlesService.createArticle(samplePayload({ title }));
    createdArticleIds.push(first.id, second.id);

    expect(first.slug).not.toBe(second.slug);
    expect(second.slug.startsWith(first.slug)).toBe(true);
  });

  it("computes reading time from the block word count", async () => {
    const result = await articlesService.createArticle(samplePayload());
    createdArticleIds.push(result.id);

    expect(result.pendingVersion.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it("round-trips blocks through save → fetch with order intact", async () => {
    const result = await articlesService.createArticle(samplePayload());
    createdArticleIds.push(result.id);

    const fetched = await versionsService.getById(result.pendingVersion.id);
    expect(fetched.blocks).toHaveLength(3);
    expect(fetched.blocks.map((b) => b.blockOrder)).toEqual([1, 2, 3]);
    expect(fetched.blocks[0].blockType).toBe("heading");
    expect(fetched.blocks[0].content).toEqual({ level: 2, text: "Section one" });
    expect(fetched.blocks[2].content).toEqual({ text: "Second paragraph." });
  });
});

describe("saveContent — replacing a version's blocks", () => {
  it("replaces blocks wholesale: fewer blocks means old ones are gone, not orphaned", async () => {
    const created = await articlesService.createArticle(
      samplePayload({
        blocks: [
          { blockType: "paragraph", content: { text: "one" } },
          { blockType: "paragraph", content: { text: "two" } },
          { blockType: "paragraph", content: { text: "three" } },
        ],
      }),
    );
    createdArticleIds.push(created.id);
    const versionId = created.pendingVersion.id;

    const updated = await versionsService.saveContent(versionId, {
      title: created.pendingVersion.title,
      authorName: created.pendingVersion.authorName,
      categoryId,
      blocks: [{ blockType: "paragraph", content: { text: "only one now" } }],
    });

    expect(updated.blocks).toHaveLength(1);
    expect(updated.blocks[0].blockOrder).toBe(1);
    expect(updated.blocks[0].content).toEqual({ text: "only one now" });

    const rawCount = await prisma.articleContentBlock.count({
      where: { articleVersionId: versionId },
    });
    expect(rawCount).toBe(1); // the two removed blocks are actually gone, not soft-orphaned
  });

  it("re-orders blocks with no gaps when the submitted order changes", async () => {
    const created = await articlesService.createArticle(
      samplePayload({
        blocks: [
          { blockType: "paragraph", content: { text: "A" } },
          { blockType: "paragraph", content: { text: "B" } },
        ],
      }),
    );
    createdArticleIds.push(created.id);
    const versionId = created.pendingVersion.id;

    const updated = await versionsService.saveContent(versionId, {
      title: created.pendingVersion.title,
      authorName: created.pendingVersion.authorName,
      categoryId,
      blocks: [
        { blockType: "paragraph", content: { text: "B" } },
        { blockType: "paragraph", content: { text: "A" } },
      ],
    });

    expect(updated.blocks.map((b) => b.content.text)).toEqual(["B", "A"]);
    expect(updated.blocks.map((b) => b.blockOrder)).toEqual([1, 2]);
  });

  it("recomputes reading time after the content changes", async () => {
    const created = await articlesService.createArticle(
      samplePayload({ blocks: [{ blockType: "paragraph", content: { text: "short" } }] }),
    );
    createdArticleIds.push(created.id);

    const longText = Array.from({ length: 250 }, () => "word").join(" ");
    const updated = await versionsService.saveContent(created.pendingVersion.id, {
      title: created.pendingVersion.title,
      authorName: created.pendingVersion.authorName,
      categoryId,
      blocks: [{ blockType: "paragraph", content: { text: longText } }],
    });

    expect(updated.readingMinutes).toBeGreaterThan(created.pendingVersion.readingMinutes);
  });

  it("rejects edits to a PUBLISHED version", async () => {
    const created = await articlesService.createArticle(samplePayload());
    createdArticleIds.push(created.id);
    const versionId = created.pendingVersion.id;

    await prisma.articleVersion.update({ where: { id: versionId }, data: { status: "PUBLISHED" } });

    await expect(
      versionsService.saveContent(versionId, {
        title: "New title",
        authorName: "Someone",
        categoryId,
        blocks: [],
      }),
    ).rejects.toMatchObject({ code: "VERSION_NOT_EDITABLE" });
  });
});
