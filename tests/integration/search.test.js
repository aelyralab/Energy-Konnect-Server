/**
 * Hits the live database directly through the service layer — no mocks.
 * Verifies Phase 10's explicit "done when" bar: searching "rooftop solar
 * gujarat" against the seeded corpus returns the expected article first.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "../../src/config/db.js";
import { retireTestUsers } from "../helpers/users.js";
import { hashPassword } from "../../src/utils/password.js";
import * as adminService from "../../src/modules/admin/admin.service.js";
import * as searchService from "../../src/modules/search/search.service.js";

let adminId;
let categoryId;
const createdArticleIds = [];
const createdUserIds = [];

beforeAll(async () => {
  const category = await prisma.category.findFirst();
  if (!category) throw new Error("Seed data required — run `npm run seed` before the test suite");
  categoryId = category.id;

  const admin = await prisma.user.create({
    data: {
      name: "Phase 10 Admin",
      email: `phase10-admin-${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: await hashPassword("Test-Password-123"),
      role: "ADMIN",
      emailVerified: true,
    },
  });
  adminId = admin.id;
  createdUserIds.push(admin.id);
});

afterAll(async () => {
  if (createdArticleIds.length > 0) {
    await prisma.article.deleteMany({ where: { id: { in: createdArticleIds } } });
  }
  if (createdUserIds.length > 0) {
    await retireTestUsers(createdUserIds);
  }
});

describe("search — the seeded corpus", () => {
  it('PHASE 10 DONE-WHEN: searching "rooftop solar gujarat" returns the expected article first', async () => {
    const result = await searchService.search({ q: "rooftop solar gujarat", page: 1, limit: 20 });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].slug).toBe("solar-rooftop-policies-regulations-gujarat");
  });

  it("returns a snippet drawn from the article's summary/subtitle", async () => {
    const result = await searchService.search({ q: "rooftop solar gujarat", page: 1, limit: 20 });
    const top = result.items[0];
    expect(typeof top.snippet).toBe("string");
    expect(top.snippet.length).toBeGreaterThan(0);
  });

  it("finds an article by a term that only appears in its taxonomy (category/topic/tag), not its title", async () => {
    // "Kitchen Waste" is a tag on the biogas article, not part of its title.
    const result = await searchService.search({ q: "kitchen waste", page: 1, limit: 20 });
    expect(result.items.map((i) => i.slug)).toContain("biogas-from-kitchen-waste");
  });

  it("an unrelated query returns no results, not an error", async () => {
    const result = await searchService.search({
      q: "xyznonexistentquerytermzzz",
      page: 1,
      limit: 20,
    });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("combines a text query with a category filter", async () => {
    const withCategory = await searchService.search({
      q: "solar",
      category: "energy-policy",
      page: 1,
      limit: 20,
    });
    expect(withCategory.items.every((i) => i.category?.slug === "energy-policy")).toBe(true);
    expect(withCategory.items.length).toBeGreaterThan(0);

    const wrongCategory = await searchService.search({
      q: "solar",
      category: "thermal-power",
      page: 1,
      limit: 20,
    });
    expect(
      wrongCategory.items.some((i) => i.slug === "solar-rooftop-policies-regulations-gujarat"),
    ).toBe(false);
  });
});

describe("search — respects publication status", () => {
  it("never returns a DRAFT article, even with an exact title match", async () => {
    const uniqueWord = `Zzyxphase10draft${Date.now()}`;
    const draft = await adminService.createArticle(
      adminId,
      {
        title: `${uniqueWord} Search Test`,
        summary: "This draft should never be findable via search.",
        authorName: "Test Author",
        categoryId,
        blocks: [],
      },
      { publish: false },
    );
    createdArticleIds.push(draft.id);

    const result = await searchService.search({ q: uniqueWord, page: 1, limit: 20 });
    expect(result.items).toHaveLength(0);
  });

  it("finds a freshly-published article by its title immediately (search_text maintained on write)", async () => {
    const uniqueWord = `Zzyxphase10published${Date.now()}`;
    const published = await adminService.createArticle(
      adminId,
      {
        title: `${uniqueWord} Search Test`,
        summary: "This one should be findable right after publishing.",
        authorName: "Test Author",
        categoryId,
        blocks: [],
      },
      { publish: true },
    );
    createdArticleIds.push(published.id);

    const result = await searchService.search({ q: uniqueWord, page: 1, limit: 20 });
    expect(result.items.map((i) => i.slug)).toContain(published.slug);
  });

  it("stops finding an article by title once it's unpublished", async () => {
    const uniqueWord = `Zzyxphase10unpublish${Date.now()}`;
    const published = await adminService.createArticle(
      adminId,
      {
        title: `${uniqueWord} Search Test`,
        summary: "Findable until unpublished.",
        authorName: "Test Author",
        categoryId,
        blocks: [],
      },
      { publish: true },
    );
    createdArticleIds.push(published.id);

    const before = await searchService.search({ q: uniqueWord, page: 1, limit: 20 });
    expect(before.items.map((i) => i.slug)).toContain(published.slug);

    await adminService.unpublish(adminId, published.id);

    const after = await searchService.search({ q: uniqueWord, page: 1, limit: 20 });
    expect(after.items.map((i) => i.slug)).not.toContain(published.slug);
  });

  it("becomes findable by its NEW category name after an edit changes the category", async () => {
    const otherCategory = await prisma.category.findFirst({ where: { id: { not: categoryId } } });
    if (!otherCategory) return; // seed always has multiple categories; guard just in case

    const uniqueWord = `Zzyxphase10recat${Date.now()}`;
    const published = await adminService.createArticle(
      adminId,
      {
        title: `${uniqueWord} Search Test`,
        summary: "Category will change after publish.",
        authorName: "Test Author",
        categoryId,
        blocks: [],
      },
      { publish: true },
    );
    createdArticleIds.push(published.id);

    // Not findable by the *other* category's name yet.
    const before = await searchService.search({
      q: otherCategory.name,
      page: 1,
      limit: 100,
    });
    expect(before.items.map((i) => i.slug)).not.toContain(published.slug);

    await adminService.editPublished(adminId, published.id, {
      title: published.title,
      summary: published.summary,
      authorName: "Test Author",
      categoryId: otherCategory.id,
      blocks: [],
    });

    const after = await searchService.search({ q: otherCategory.name, page: 1, limit: 100 });
    expect(after.items.map((i) => i.slug)).toContain(published.slug);
  });
});

describe("search — pagination", () => {
  it("carries page/limit/total metadata", async () => {
    const result = await searchService.search({ q: "energy", page: 1, limit: 1 });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(1);
    expect(result.items.length).toBeLessThanOrEqual(1);
    expect(typeof result.total).toBe("number");
  });
});
