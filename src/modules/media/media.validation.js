import { z } from "zod";

// One endpoint for both the single-item delete button and the multi-select
// bar — the individual case is just a one-element array.
export const deleteManySchema = {
  body: z.object({
    ids: z.array(z.string().uuid()).min(1, "At least one media id is required").max(200),
  }),
};
