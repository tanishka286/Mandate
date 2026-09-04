import { z } from "zod";

/** Phase 0 placeholder schema — domain validation arrives in later phases. */
export const basketPlaceholderSchema = z.object({
  module: z.literal("basket"),
});
