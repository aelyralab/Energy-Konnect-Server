import { describe, it, expect } from "vitest";
import { blockSchema, blocksArraySchema, BLOCK_TYPES } from "../../src/utils/blockSchemas.js";

const VALID_MEDIA_ID = "11111111-1111-4111-8111-111111111111";

/** One valid example per block type, keyed by blockType. */
const VALID_EXAMPLES = {
  heading: { blockType: "heading", content: { level: 2, text: "Introduction" } },
  paragraph: { blockType: "paragraph", content: { text: "Article paragraph text." } },
  image: {
    blockType: "image",
    content: { mediaId: VALID_MEDIA_ID, caption: "A caption", altText: "Alt text" },
  },
  quote: {
    blockType: "quote",
    content: { text: "An important quotation.", attribution: "R N Sen" },
  },
  callout: { blockType: "callout", content: { title: "Note", text: "Read this first." } },
  table: {
    blockType: "table",
    content: {
      columns: ["Parameter", "Value"],
      rows: [
        ["Outlay", "₹3.03 trillion"],
        ["Support", "₹976.31 billion"],
      ],
    },
  },
  figure: {
    blockType: "figure",
    content: { mediaId: VALID_MEDIA_ID, caption: "Network diagram", source: "Energy Konnect" },
  },
  list: { blockType: "list", content: { style: "unordered", items: ["First", "Second"] } },
  formula: { blockType: "formula", content: { expression: "ACS - ARR" } },
  reference: {
    blockType: "reference",
    content: { items: [{ label: "Source document", url: "https://example.com" }] },
  },
};

describe("blockSchema — every block type accepts its documented shape", () => {
  it("covers all ten block types from the context doc", () => {
    expect(BLOCK_TYPES.sort()).toEqual(
      [
        "heading",
        "paragraph",
        "image",
        "quote",
        "callout",
        "table",
        "figure",
        "list",
        "formula",
        "reference",
      ].sort(),
    );
  });

  for (const type of BLOCK_TYPES) {
    it(`accepts a valid ${type} block`, () => {
      const result = blockSchema.safeParse(VALID_EXAMPLES[type]);
      expect(result.success).toBe(true);
    });
  }

  it("accepts blocks with only their required fields (optionals omitted)", () => {
    expect(blockSchema.safeParse({ blockType: "paragraph", content: { text: "x" } }).success).toBe(
      true,
    );
    expect(
      blockSchema.safeParse({ blockType: "formula", content: { expression: "E=mc^2" } }).success,
    ).toBe(true);
    // A citation without a URL is the common case — most are print issues.
    expect(
      blockSchema.safeParse({ blockType: "reference", content: { items: [{ label: "Vol 1" }] } })
        .success,
    ).toBe(true);
  });
});

describe("blockSchema — rejection cases", () => {
  it("rejects an unknown blockType", () => {
    const result = blockSchema.safeParse({ blockType: "video", content: { url: "x" } });
    expect(result.success).toBe(false);
  });

  it("rejects a table whose row length doesn't match its column count", () => {
    const result = blockSchema.safeParse({
      blockType: "table",
      content: {
        columns: ["A", "B"],
        rows: [["only-one-cell"]],
      },
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toContain("rows");
  });

  it("rejects a table with zero columns", () => {
    const result = blockSchema.safeParse({
      blockType: "table",
      content: { columns: [], rows: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a heading with an out-of-range level", () => {
    expect(
      blockSchema.safeParse({ blockType: "heading", content: { level: 7, text: "x" } }).success,
    ).toBe(false);
    expect(
      blockSchema.safeParse({ blockType: "heading", content: { level: 0, text: "x" } }).success,
    ).toBe(false);
  });

  it("rejects empty required text fields", () => {
    expect(blockSchema.safeParse({ blockType: "paragraph", content: { text: "" } }).success).toBe(
      false,
    );
    expect(blockSchema.safeParse({ blockType: "quote", content: { text: "   " } }).success).toBe(
      false,
    );
  });

  it("rejects an image with a non-uuid mediaId", () => {
    const result = blockSchema.safeParse({
      blockType: "image",
      content: { mediaId: "not-a-uuid" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a list with an invalid style", () => {
    const result = blockSchema.safeParse({
      blockType: "list",
      content: { style: "numbered", items: ["a"] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a list with zero items", () => {
    const result = blockSchema.safeParse({
      blockType: "list",
      content: { style: "ordered", items: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a reference with an invalid URL", () => {
    const result = blockSchema.safeParse({
      blockType: "reference",
      content: { items: [{ label: "x", url: "not-a-url" }] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a reference with no citations", () => {
    const result = blockSchema.safeParse({ blockType: "reference", content: { items: [] } });
    expect(result.success).toBe(false);
  });

  it("rejects content belonging to the wrong block type", () => {
    // A paragraph's shape submitted under blockType "heading" — content is
    // missing the required `level` field.
    const result = blockSchema.safeParse({ blockType: "heading", content: { text: "x" } });
    expect(result.success).toBe(false);
  });
});

describe("blocksArraySchema", () => {
  it("accepts an empty array — a draft may have zero blocks", () => {
    expect(blocksArraySchema.safeParse([]).success).toBe(true);
  });

  it("accepts a mixed array of multiple valid block types", () => {
    const blocks = [VALID_EXAMPLES.heading, VALID_EXAMPLES.paragraph, VALID_EXAMPLES.list];
    expect(blocksArraySchema.safeParse(blocks).success).toBe(true);
  });

  it("rejects the whole array if any single block is invalid", () => {
    const blocks = [VALID_EXAMPLES.heading, { blockType: "paragraph", content: { text: "" } }];
    expect(blocksArraySchema.safeParse(blocks).success).toBe(false);
  });
});
