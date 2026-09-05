import { z } from "zod";
import { sessionIdSchema } from "../sessions/schema.js";

export const runSessionPlanBodySchema = z
  .object({
    intent_id: z.string().uuid(),
  })
  .strict();

export type RunSessionPlanBody = z.infer<typeof runSessionPlanBodySchema>;

export const runSessionPlanDataSchema = z
  .object({
    session_id: sessionIdSchema,
    intent_id: z.string().uuid(),
    outcome: z.enum(["COMPLETED", "FAILED", "CLARIFICATION_REQUIRED"]),
    optimization_run_id: z.string().uuid().nullable(),
    best_value_basket_id: z.string().uuid().nullable(),
    best_quality_basket_id: z.string().uuid().nullable(),
    recommended_basket_type: z
      .enum(["BEST_VALUE", "BEST_QUALITY"])
      .nullable(),
    catalog_research_skipped: z.boolean(),
  })
  .strict();

export type RunSessionPlanData = z.infer<typeof runSessionPlanDataSchema>;
