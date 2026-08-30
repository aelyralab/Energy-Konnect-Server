/**
 * Validation for the ten structured content block types (context doc §14).
 * An unknown `blockType`, or a `table` block whose row lengths don't match
 * its column count, is rejected here — before it ever reaches Postgres as an
 * opaque JSONB blob (§15: relational scaffolding, flexible payload).
 *
 * Field names are camelCase throughout (`mediaId`, `altText`), matching the
 * rest of this API's wire format — the doc's §14 examples use snake_case,
 * but those are illustrative of the block *concept*, not a mandated wire
 * shape, and every other response in this API is camelCase.
 */
import { z } from "zod";

const mediaId = z.string().uuid("mediaId must reference an uploaded media asset");
const nonEmptyText = (label) => z.string().trim().min(1, `${label} is required`);

const BLOCK_CONTENT_SCHEMAS = {
  heading: z.object({
    level: z.number().int().min(1).max(6),
    text: nonEmptyText("Heading text"),
  }),

  paragraph: z.object({
    text: nonEmptyText("Paragraph text"),
  }),

  image: z.object({
    mediaId,
    caption: z.string().trim().max(500).optional(),
    altText: z.string().trim().max(300).optional(),
  }),

  quote: z.object({
    text: nonEmptyText("Quote text"),
    attribution: z.string().trim().max(200).optional(),
  }),

  callout: z.object({
    title: z.string().trim().max(200).optional(),
    text: nonEmptyText("Callout text"),
  }),

  table: z
    .object({
      caption: z.string().trim().max(300).optional(),
      columns: z.array(z.string().trim().min(1)).min(1, "At least one column is required"),
      rows: z.array(z.array(z.string())).min(1, "At least one row is required"),
    })
    .refine((value) => value.rows.every((row) => row.length === value.columns.length), {
      message: "Every row must have exactly as many cells as there are columns",
      path: ["rows"],
    }),

  figure: z.object({
    mediaId,
    caption: z.string().trim().max(500).optional(),
    source: z.string().trim().max(300).optional(),
  }),

  list: z.object({
    style: z.enum(["ordered", "unordered", "roman", "letter"]),
    items: z.array(z.string().trim().min(1)).min(1, "At least one item is required"),
  }),

  // `expression`/`note` rather than `formula`/`caption`: the source material
  // states formulas in words, not symbols, and this is the shape prisma/seed.js
  // has always written. Validating the other shape made every seeded formula
  // block un-round-trippable through PUT.
  formula: z.object({
    expression: nonEmptyText("Formula expression"),
    note: z.string().trim().max(300).optional(),
  }),

  // A list of citations, not a single one — every seeded article cites more
  // than one source, and `url` is optional because most citations here are
  // print issues of the magazine rather than links.
  reference: z.object({
    items: z
      .array(
        z.object({
          label: nonEmptyText("Reference label"),
          url: z.string().url("A valid URL is required").optional(),
        }),
      )
      .min(1, "At least one reference is required"),
  }),
};

export const BLOCK_TYPES = Object.keys(BLOCK_CONTENT_SCHEMAS);

/**
 * One entry in an article version's content: `{ blockType, content }`. The
 * discriminant (`blockType`) lives one level up from the type-specific
 * payload, which is what lets zod's discriminated union pick the right
 * branch — and therefore report a precise error — before validating
 * `content` at all.
 */
export const blockSchema = z.discriminatedUnion(
  "blockType",
  BLOCK_TYPES.map((type) =>
    z.object({ blockType: z.literal(type), content: BLOCK_CONTENT_SCHEMAS[type] }),
  ),
);

// No minimum here — an in-progress draft can legitimately have zero blocks.
// The "at least one meaningful block" rule (context doc §26) is a
// submit-time gate that belongs to the publisher workflow (Phase 6), not to
// core persistence.
export const blocksArraySchema = z.array(blockSchema);

export default blockSchema;
