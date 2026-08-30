import { z } from "zod";
import { blocksArraySchema } from "../../utils/blockSchemas.js";

/**
 * A version's full editable payload — what a "save" from the article editor
 * submits. Lenient by design: an in-progress draft can be missing a summary
 * or have zero blocks. The stricter "everything required" gate (context doc
 * §26) applies only at submit-for-review time, which belongs to the
 * publisher workflow (Phase 6), not here.
 *
 * Exported as a plain object (not the refined schema) so publisher/admin
 * validation can `.extend()` it with their own fields — ZodEffects (what
 * `.superRefine()` returns) has no `.extend()` method. Apply
 * `withContentModeRule` after any extension, never before.
 */
export const versionContentShape = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  subtitle: z.string().trim().max(400).optional(),
  summary: z.string().trim().max(2000).optional(),
  authorName: z.string().trim().min(1, "Author name is required").max(200),
  authorBio: z.string().trim().max(2000).optional(),
  categoryId: z.string().uuid("A category is required"),
  coverMediaId: z.string().uuid().optional(),

  // Dual-mode articles: BLOCKS is the native editor, PDF wraps an uploaded
  // file (used for the legacy magazine back-catalogue). Metadata above is
  // shared by both modes; only the body differs.
  contentMode: z.enum(["BLOCKS", "PDF"]).default("BLOCKS"),
  pdfMediaId: z.string().uuid().nullable().optional(),
  pdfPageCount: z.number().int().positive().max(2000).nullable().optional(),

  blocks: blocksArraySchema.default([]),
});

/** PDF-mode articles need a PDF. Applied after any `.extend()`. */
export function withContentModeRule(schema) {
  return schema.superRefine((value, ctx) => {
    if (value.contentMode === "PDF" && !value.pdfMediaId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pdfMediaId"],
        message: "A PDF article needs a PDF file",
      });
    }
  });
}

export const versionContentSchema = withContentModeRule(versionContentShape);
