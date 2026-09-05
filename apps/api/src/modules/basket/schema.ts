import { z } from "zod";
import {
  cartQuantitySchema,
  moneyMinorSchema,
  skuIdSchema,
} from "../cart/schema.js";
import { sessionIdSchema, userIdSchema } from "../sessions/schema.js";
import {
  QUOTE_AMOUNT_KIND,
  QUOTE_CURRENCY,
  quoteAppliedIncentiveSchema,
  quoteLineResultSchema,
  untrustedQuoteClaimsSchema,
} from "../quote/schema.js";

/** Accepts UTC ISO timestamps from Postgres/Supabase. */
const isoUtcTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

export const BASKET_TYPES = ["BEST_VALUE", "BEST_QUALITY"] as const;
export type BasketType = (typeof BASKET_TYPES)[number];
export const basketTypeSchema = z.enum(BASKET_TYPES);

export const BASKET_STATUSES = ["CURRENT", "SUPERSEDED"] as const;
export type BasketStatus = (typeof BASKET_STATUSES)[number];
export const basketStatusSchema = z.enum(BASKET_STATUSES);

export const SELECTION_SOURCES = ["USER"] as const;
export type SelectionSource = (typeof SELECTION_SOURCES)[number];
export const selectionSourceSchema = z.enum(SELECTION_SOURCES);

export const QUOTE_ROW_STATUSES = ["CURRENT", "SUPERSEDED", "STALE"] as const;
export type QuoteRowStatus = (typeof QUOTE_ROW_STATUSES)[number];
export const quoteRowStatusSchema = z.enum(QUOTE_ROW_STATUSES);

export const basketIdSchema = z.string().uuid();
export const basketItemIdSchema = z.string().uuid();
export const selectionIdSchema = z.string().uuid();
export const quoteIdSchema = z.string().uuid();
export const optimizationRunIdSchema = z.string().uuid();

export const basketItemViewSchema = z
  .object({
    basket_item_id: basketItemIdSchema,
    basket_id: basketIdSchema,
    requirement_id: z.string().uuid().nullable(),
    sku_id: skuIdSchema,
    quantity: cartQuantitySchema,
    unit_price_minor: moneyMinorSchema,
    line_amount_minor: moneyMinorSchema,
    quality_level: z.string().nullable(),
    evidence_refs_json: z.array(z.unknown()),
    created_at: isoUtcTimestampSchema,
    updated_at: isoUtcTimestampSchema,
  })
  .strict();

export type BasketItemView = z.infer<typeof basketItemViewSchema>;

export const basketViewSchema = z
  .object({
    basket_id: basketIdSchema,
    optimization_run_id: optimizationRunIdSchema,
    session_id: sessionIdSchema,
    user_id: userIdSchema,
    basket_type: basketTypeSchema,
    status: basketStatusSchema,
    gross_amount_minor: moneyMinorSchema,
    discount_amount_minor: moneyMinorSchema,
    final_payable_minor: moneyMinorSchema,
    currency: z.literal(QUOTE_CURRENCY),
    quality_summary: z.string().nullable(),
    recommendation_reason: z.string().nullable(),
    explanation: z.string().nullable(),
    combination_key: z.string().nullable(),
    state_version: z.number().int().positive(),
    items: z.array(basketItemViewSchema),
    created_at: isoUtcTimestampSchema,
    updated_at: isoUtcTimestampSchema,
  })
  .strict();

export type BasketView = z.infer<typeof basketViewSchema>;

export const createBasketSelectionBodySchema = z
  .object({
    basket_id: basketIdSchema,
    selection_source: selectionSourceSchema,
  })
  .strict();

export type CreateBasketSelectionBody = z.infer<
  typeof createBasketSelectionBodySchema
>;

export const basketSelectionDataSchema = z
  .object({
    selection_id: selectionIdSchema,
    session_id: sessionIdSchema,
    basket_id: basketIdSchema,
    selection_source: selectionSourceSchema,
    status: z.literal("SELECTED"),
    selected_at: isoUtcTimestampSchema,
    superseded_at: isoUtcTimestampSchema.nullable(),
    created_at: isoUtcTimestampSchema,
    /** Explicit non-authorization markers (Phase 7). */
    order_created: z.literal(false),
    payment_created: z.literal(false),
    policy_decision: z.null(),
  })
  .strict();

export type BasketSelectionData = z.infer<typeof basketSelectionDataSchema>;

export const createBasketQuoteBodySchema = z
  .object({
    /**
     * Untrusted client money claims — ignored by the server.
     * Present only so tests can prove they do not affect totals.
     */
    client_claims: untrustedQuoteClaimsSchema,
  })
  .strict();

export type CreateBasketQuoteBody = z.infer<typeof createBasketQuoteBodySchema>;

export const basketQuoteDataSchema = z
  .object({
    quote_id: quoteIdSchema,
    basket_id: basketIdSchema,
    session_id: sessionIdSchema,
    selection_id: selectionIdSchema.nullable(),
    optimization_run_id: optimizationRunIdSchema,
    currency: z.literal(QUOTE_CURRENCY),
    amount_kind: z.literal(QUOTE_AMOUNT_KIND),
    gross_amount_minor: moneyMinorSchema,
    discount_amount_minor: moneyMinorSchema,
    final_payable_minor: moneyMinorSchema,
    quote_version: z.string().min(1),
    basket_state_version: z.number().int().positive(),
    lines: z.array(quoteLineResultSchema).min(1),
    applied_incentives: z.array(quoteAppliedIncentiveSchema),
    catalog_fingerprint: z.string().min(1),
    incentive_fingerprint: z.string().min(1),
    /** Explicit non-authorization markers. */
    policy_decision: z.null(),
    payment_created: z.literal(false),
    order_created: z.literal(false),
  })
  .strict();

export type BasketQuoteData = z.infer<typeof basketQuoteDataSchema>;

export const sessionBasketsDataSchema = z
  .object({
    session_id: sessionIdSchema,
    optimization_run_id: optimizationRunIdSchema.nullable(),
    best_value: basketViewSchema.nullable(),
    best_quality: basketViewSchema.nullable(),
    recommendation: z
      .object({
        recommended_basket_type: basketTypeSchema.nullable(),
        recommended_basket_id: basketIdSchema.nullable(),
        reason: z.string().nullable(),
        tradeoff_summary: z.string().nullable(),
        user_may_select_alternative: z.literal(true),
      })
      .strict()
      .nullable(),
    active_selection: basketSelectionDataSchema
      .omit({
        order_created: true,
        payment_created: true,
        policy_decision: true,
      })
      .extend({
        status: z.literal("SELECTED"),
      })
      .nullable(),
  })
  .strict();

export type SessionBasketsData = z.infer<typeof sessionBasketsDataSchema>;

export const basketIdParamsSchema = z
  .object({
    basket_id: basketIdSchema,
  })
  .strict();

export const sessionIdParamsSchema = z
  .object({
    session_id: sessionIdSchema,
  })
  .strict();

/**
 * Internal materialization input (tests / agent persistence).
 * Not an HTTP create-basket endpoint — optimization owns proposal generation.
 */
export const materializeBasketLineSchema = z
  .object({
    sku_id: skuIdSchema,
    quantity: cartQuantitySchema,
    requirement_id: z.string().uuid().nullable().optional(),
    unit_price_minor: moneyMinorSchema.optional(),
    line_amount_minor: moneyMinorSchema.optional(),
    quality_level: z.string().nullable().optional(),
    evidence_refs_json: z.array(z.unknown()).optional(),
  })
  .strict();

export const materializeBasketInputSchema = z
  .object({
    basket_type: basketTypeSchema,
    items: z.array(materializeBasketLineSchema).min(1),
    gross_amount_minor: moneyMinorSchema.optional(),
    discount_amount_minor: moneyMinorSchema.optional(),
    final_payable_minor: moneyMinorSchema.optional(),
    quality_summary: z.string().nullable().optional(),
    recommendation_reason: z.string().nullable().optional(),
    explanation: z.string().nullable().optional(),
    combination_key: z.string().nullable().optional(),
  })
  .strict();

export const materializeOptimizationBasketsInputSchema = z
  .object({
    session_id: sessionIdSchema,
    intent_id: z.string().uuid().nullable().optional(),
    mandate_id: z.string().uuid().nullable().optional(),
    best_value: materializeBasketInputSchema.nullable().optional(),
    best_quality: materializeBasketInputSchema.nullable().optional(),
    recommendation: z
      .object({
        recommended_basket_type: basketTypeSchema.nullable(),
        reason: z.string().nullable().optional(),
        tradeoff_summary: z.string().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    /**
     * Optional incentive claims associated with the run for fresh-quote input.
     * Validity is re-checked at quote time — never trusted as payable authority.
     */
    incentives: z
      .array(
        z
          .object({
            incentive_id: z.string().min(1),
            kind: z.enum(["VOUCHER", "LOYALTY", "MERCHANT_DEAL"]),
            decision: z.enum(["USE_NOW", "SAVE_FOR_LATER", "DO_NOT_USE"]),
            validity: z.enum(["VALID", "EXPIRED", "INVALID"]),
            eligibility: z.enum(["ELIGIBLE", "INELIGIBLE"]),
            benefit_minor: moneyMinorSchema,
            benefit_identity: z.string().min(1).optional(),
            /** Optional absolute expiry; when past, treated as EXPIRED at quote. */
            valid_until: isoUtcTimestampSchema.nullable().optional(),
          })
          .strict(),
      )
      .optional()
      .default([]),
    /** Phase 9 audit correlation — optional, not used for authorization. */
    agent_run_id: z.string().uuid().nullable().optional(),
    request_id: z.string().nullable().optional(),
  })
  .strict();

export type MaterializeOptimizationBasketsInput = z.infer<
  typeof materializeOptimizationBasketsInputSchema
>;
