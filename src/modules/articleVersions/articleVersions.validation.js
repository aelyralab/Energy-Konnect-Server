import { z } from "zod";
import { blocksArraySchema } from "../../utils/blockSchemas.js";

/**
 * A version's full editable payload — what a "save" from the article editor
 * submits. Lenient by design: an in-progress draft can be missing a summary
 * or have zero blocks. The stricter "everything required" gate (context doc
 * §26) applies only at submit-for-review time, which belongs to the
 * publisher workflow (Phase 6), not here.
 */
export const versionContentSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  subtitle: z.string().trim().max(400).optional(),
  summary: z.string().trim().max(2000).optional(),
  authorName: z.string().trim().min(1, "Author name is required").max(200),
  authorBio: z.string().trim().max(2000).optional(),
  categoryId: z.string().uuid("A category is required"),
  coverMediaId: z.string().uuid().optional(),
  blocks: blocksArraySchema,
});
