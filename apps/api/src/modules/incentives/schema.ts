import { z } from "zod";
import { moneyMinorSchema } from "../mandate/schema.js";

export const INCENTIVE_TYPES = ["VOUCHER", "LOYALTY_REWARD"] as const;
export type IncentiveType = (typeof INCENTIVE_TYPES)[number];
export const incentiveTypeSchema = z.enum(INCENTIVE_TYPES);

export const INCENTIVE_STATUSES = ["ACTIVE", "INACTIVE", "EXPIRED"] as const;
export type IncentiveStatus = (typeof INCENTIVE_STATUSES)[number];
export const incentiveStatusSchema = z.enum(INCENTIVE_STATUSES);

export const INCENTIVE_DECISIONS = [
  "USE_NOW",
  "SAVE_FOR_LATER",
  "DO_NOT_USE",
] as const;
export type IncentiveDecision = (typeof INCENTIVE_DECISIONS)[number];
export const incentiveDecisionSchema = z.enum(INCENTIVE_DECISIONS);

/**
 * Authoritative rules stored in incentive.rules_json (server-side only).
 * AI must never invent or override these fields.
 */
export const incentiveRulesSchema = z
  .object({
    benefit_identity: z.string().min(1),
    source_reference: z.string().min(1),
    /** Voucher threshold before discount applies (paise). */
    threshold_minor: moneyMinorSchema.optional().default(0),
    /** Fixed discount amount in paise (vouchers). */
    discount_minor: moneyMinorSchema.optional().default(0),
    /** Minimum basket spend to qualify (paise). */
    minimum_spend_minor: moneyMinorSchema.optional().default(0),
    /** Known future utility in paise; null/omitted = unknown. */
    future_use_value_minor: moneyMinorSchema.nullable().optional(),
    /** Loyalty monetary redeemable value (paise). */
    redeemable_value_minor: moneyMinorSchema.optional(),
    value_kind: z.enum(["MONETARY", "POINTS_ONLY"]).optional(),
    consumable: z.boolean().optional().default(true),
    fixture_code: z.string().optional(),
  })
  .strict();

export type IncentiveRules = z.output<typeof incentiveRulesSchema>;

export const incentiveIdSchema = z.string().uuid();

export const incentiveRowSchema = z.object({
  incentive_id: incentiveIdSchema,
  type: incentiveTypeSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
  status: incentiveStatusSchema,
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  rules_json: z.unknown(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type IncentiveRow = z.infer<typeof incentiveRowSchema>;

export const incentiveEvaluationRowSchema = z.object({
  evaluation_id: z.string().uuid(),
  optimization_run_id: z.string().uuid(),
  basket_id: z.string().uuid().nullable(),
  incentive_id: incentiveIdSchema,
  decision: incentiveDecisionSchema,
  current_saving_minor: z.number().int().nonnegative(),
  future_value_minor: z.number().int().nonnegative().nullable(),
  reason: z.string().nullable(),
  eligibility_snapshot: z.unknown(),
  created_at: z.string(),
});

export type IncentiveEvaluationRow = z.infer<typeof incentiveEvaluationRowSchema>;

export const persistIncentiveEvaluationInputSchema = z.object({
  optimization_run_id: z.string().uuid(),
  basket_id: z.string().uuid().nullable().optional(),
  incentive_id: incentiveIdSchema,
  decision: incentiveDecisionSchema,
  current_saving_minor: moneyMinorSchema,
  future_value_minor: moneyMinorSchema.nullable().optional(),
  reason: z.string().nullable().optional(),
  eligibility_snapshot: z.record(z.unknown()).optional().default({}),
});

export type PersistIncentiveEvaluationInput = z.infer<
  typeof persistIncentiveEvaluationInputSchema
>;
