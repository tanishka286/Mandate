import { z } from "zod";

/** Phase 0 placeholder schema — domain validation arrives in later phases. */
export const researchPlaceholderSchema = z.object({
  module: z.literal("research"),
});
