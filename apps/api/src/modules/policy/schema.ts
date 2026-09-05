import { z } from "zod";
import {
  POLICY_REASON_CODES,
  POLICY_VERSION,
  type PolicyReasonCode,
} from "./reason-codes.js";

/**
 * Policy decision outcomes (Doc 06 / Doc 07 / Doc 08).
 */
export const POLICY_DECISIONS = ["ALLOW", "DENY"] as const;

export type PolicyDecisionOutcome = (typeof POLICY_DECISIONS)[number];

export const policyDecisionOutcomeSchema = z.enum(POLICY_DECISIONS);

export const policyReasonCodeSchema = z.enum(POLICY_REASON_CODES);

/** Accepts UTC ISO timestamps from Postgres/Supabase. */
const isoUtcTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

export const policyDecisionIdSchema = z.string().uuid();

export const mandateIdSchema = z.string().uuid();

export const basketIdSchema = z.string().uuid();

export const userIdSchema = z.string().uuid();

/** Integer minor-unit money (paise). Never floating point. */
export const moneyMinorSchema = z
  .number({
    invalid_type_error: "money must be an integer minor-unit amount",
  })
  .int("money must be an integer minor-unit amount")
  .nonnegative("money must be >= 0");

export const policyVersionSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "policy_version must not be empty",
  });

export const requestIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "request_id must not be empty",
  });

export const policyLineQuantitySchema = z
  .number({
    invalid_type_error: "quantity must be an integer",
  })
  .int("quantity must be an integer")
  .min(1, "quantity must be >= 1");

/**
 * Interim basket line contract: sku_id + quantity only.
 * Rejects client/LLM price, category, stock, line_amount, and payable fields.
 * Financial/catalog facts are loaded from authoritative backend adapters.
 */
export const policyEvaluateLineSchema = z
  .object({
    sku_id: z.string().uuid(),
    quantity: policyLineQuantitySchema,
  })
  .strict();

/**
 * Evaluation request used by PolicyService.
 * Interim line contract — not the Doc 08 HTTP body.
 * idempotency_key + quote_version required for durable authorization idempotency.
 */
export const policyEvaluateRequestSchema = z
  .object({
    user_id: userIdSchema,
    mandate_id: mandateIdSchema,
    basket_id: basketIdSchema,
    request_id: requestIdSchema,
    idempotency_key: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "idempotency_key must not be empty",
      }),
    quote_version: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "quote_version must not be empty",
      }),
    lines: z.array(policyEvaluateLineSchema).min(1),
    claimed_incentive_ids: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type PolicyEvaluateRequest = z.infer<typeof policyEvaluateRequestSchema>;

/**
 * Doc 08 POST /policy/evaluate HTTP body.
 * Only mandate_id, basket_id, quote_version — no financial/catalog fields.
 */
export const policyEvaluateHttpBodySchema = z
  .object({
    mandate_id: mandateIdSchema,
    basket_id: basketIdSchema,
    quote_version: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "quote_version must not be empty",
      }),
  })
  .strict();

export type PolicyEvaluateHttpBody = z.infer<typeof policyEvaluateHttpBodySchema>;

/**
 * Pre-payment / immediate pre-checkout revalidation context (Doc 06 §17).
 *
 * Correlation + idempotency only — never authoritative financial/catalog/decision
 * inputs. Lines and incentives come from QuoteResolutionPort; money/stock/category
 * come from PolicyService adapters. A prior ALLOW is never accepted here.
 */
export const policyRevalidationRequestSchema = z
  .object({
    user_id: userIdSchema,
    mandate_id: mandateIdSchema,
    basket_id: basketIdSchema,
    request_id: requestIdSchema,
    idempotency_key: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "idempotency_key must not be empty",
      }),
    quote_version: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "quote_version must not be empty",
      }),
  })
  .strict();

export type PolicyRevalidationRequest = z.infer<
  typeof policyRevalidationRequestSchema
>;

/** Doc 08 ALLOW success data (reason_code AUTHORIZED at the API boundary). */
export const policyEvaluateAllowDataSchema = z.object({
  policy_decision_id: policyDecisionIdSchema,
  decision: z.literal("ALLOW"),
  reason_code: z.literal("AUTHORIZED"),
  final_payable_minor: moneyMinorSchema,
  policy_version: z.literal(POLICY_VERSION),
});

export type PolicyEvaluateAllowData = z.infer<typeof policyEvaluateAllowDataSchema>;

/**
 * Persisted policy_decision row shape (Doc 07 §16.1).
 */
export const policyDecisionSchema = z
  .object({
    policy_decision_id: policyDecisionIdSchema,
    mandate_id: mandateIdSchema,
    basket_id: basketIdSchema,
    decision: policyDecisionOutcomeSchema,
    reason_code: z.string().nullable(),
    gross_amount_minor: moneyMinorSchema,
    discount_amount_minor: moneyMinorSchema,
    final_payable_minor: moneyMinorSchema,
    max_spend_minor: moneyMinorSchema,
    policy_version: policyVersionSchema,
    evaluated_at: isoUtcTimestampSchema,
    request_id: requestIdSchema,
    created_at: isoUtcTimestampSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.decision === "DENY" &&
      (value.reason_code === null || value.reason_code.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason_code"],
        message: "DENY decisions require a nonempty reason_code",
      });
    }

    if (value.discount_amount_minor > value.gross_amount_minor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discount_amount_minor"],
        message: "discount_amount_minor cannot exceed gross_amount_minor",
      });
    }
  });

export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

/** Structured evaluation result returned to callers (Doc 06 / Doc 08). */
export const policyEvaluationResultSchema = z.object({
  decision: policyDecisionOutcomeSchema,
  reason_code: policyReasonCodeSchema.nullable(),
  message: z.string().nullable(),
  recoverable: z.boolean(),
  policy_decision_id: policyDecisionIdSchema,
  policy_version: z.literal(POLICY_VERSION),
  mandate_id: mandateIdSchema,
  basket_id: basketIdSchema,
  gross_amount_minor: moneyMinorSchema,
  discount_amount_minor: moneyMinorSchema,
  final_payable_minor: moneyMinorSchema,
  max_spend_minor: moneyMinorSchema,
  evaluated_at: isoUtcTimestampSchema,
  request_id: requestIdSchema,
});

export type PolicyEvaluationResult = z.infer<typeof policyEvaluationResultSchema>;

export type { PolicyReasonCode };
export { POLICY_REASON_CODES, POLICY_VERSION };
