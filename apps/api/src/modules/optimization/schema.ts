import { z } from "zod";

/** Phase 0 placeholder schema — domain validation arrives in later phases. */
export const optimizationPlaceholderSchema = z.object({
  module: z.literal("optimization"),
});
