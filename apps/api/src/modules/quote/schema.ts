import { z } from "zod";
import { CART_PRICING_CURRENCY } from "../cart/pricing.js";
import {
  moneyMinorSchema,
  cartQuantitySchema,
  skuIdSchema,
} from "../cart/schema.js";

/**
 * Phase 5 Step 10 — Deterministic authoritative quote calculation (Doc 08 §13 / Doc 11).
 *
 * Quote recalculates from current backend price/stock/incentive inputs.
 * Optimization `practical_cost_minor` is NEVER authoritative payable.
 * Does not implement selection, HTTP, policy ALLOW/DENY, or payment.
 */

export const QUOTE_CURRENCY = CART_PRICING_CURRENCY;

export const quoteCurrencySchema = z.literal(QUOTE_CURRENCY);

/** Distinguishes quote money from optimization PRACTICAL_OPTIMIZATION_COST. */
export const QUOTE_AMOUNT_KIND = "AUTHORITATIVE_QUOTE" as const;

export const quoteAmountKindSchema = z.literal(QUOTE_AMOUNT_KIND);

export const QUOTE_FAILURE_REASONS = [
  "BASKET_MISSING",
  "BASKET_EMPTY",
  "SKU_MISSING",
  "AMOUNT_CALCULATION_FAILED",
  "STOCK_UNAVAILABLE",
  "VALIDATION_ERROR",
  "CURRENCY_MISMATCH",
  "INVALID_QUOTE_STATE",
] as const;

export type QuoteFailureReason = (typeof QUOTE_FAILURE_REASONS)[number];

export const quoteFailureReasonSchema = z.enum(QUOTE_FAILURE_REASONS);

export const QUOTE_INCENTIVE_KINDS = [
  "VOUCHER",
  "LOYALTY",
  "MERCHANT_DEAL",
] as const;

export type QuoteIncentiveKind = (typeof QUOTE_INCENTIVE_KINDS)[number];

export const quoteIncentiveKindSchema = z.enum(QUOTE_INCENTIVE_KINDS);

export const QUOTE_INCENTIVE_DECISIONS = [
  "USE_NOW",
  "SAVE_FOR_LATER",
  "DO_NOT_USE",
] as const;

export type QuoteIncentiveDecision =
  (typeof QUOTE_INCENTIVE_DECISIONS)[number];

export const quoteIncentiveDecisionSchema = z.enum(QUOTE_INCENTIVE_DECISIONS);

export const QUOTE_INCENTIVE_VALIDITY = [
  "VALID",
  "EXPIRED",
  "INVALID",
] as const;

export type QuoteIncentiveValidity =
  (typeof QUOTE_INCENTIVE_VALIDITY)[number];

export const quoteIncentiveValiditySchema = z.enum(QUOTE_INCENTIVE_VALIDITY);

export const QUOTE_INCENTIVE_ELIGIBILITY = [
  "ELIGIBLE",
  "INELIGIBLE",
] as const;

export type QuoteIncentiveEligibility =
  (typeof QUOTE_INCENTIVE_ELIGIBILITY)[number];

export const quoteIncentiveEligibilitySchema = z.enum(
  QUOTE_INCENTIVE_ELIGIBILITY,
);

/**
 * Authoritative incentive evaluation already resolved by the incentive domain.
 * Quote applies only VALID + ELIGIBLE + USE_NOW current benefits.
 */
export const quoteIncentiveInputSchema = z
  .object({
    incentive_id: z.string().min(1),
    kind: quoteIncentiveKindSchema,
    decision: quoteIncentiveDecisionSchema,
    validity: quoteIncentiveValiditySchema,
    eligibility: quoteIncentiveEligibilitySchema,
    /** Authoritative current saving in paise (never invented by quote). */
    benefit_minor: moneyMinorSchema,
    /** Optional double-count identity across deal/voucher/loyalty. */
    benefit_identity: z.string().min(1).optional(),
  })
  .strict();

export type QuoteIncentiveInput = z.infer<typeof quoteIncentiveInputSchema>;

/**
 * Current authoritative catalog snapshot for one SKU (backend-loaded).
 * Client/LLM/optimization prices must not substitute this.
 */
export const quoteCatalogSkuSnapshotSchema = z
  .object({
    sku_id: skuIdSchema,
    price_minor: moneyMinorSchema,
    currency: z.string().min(1),
    /** null = no stock row → fail closed (never invent availability). */
    available_quantity: z.number().finite().nonnegative().nullable(),
    sku_status: z.string().min(1).optional(),
    product_status: z.string().min(1).optional(),
  })
  .strict();

export type QuoteCatalogSkuSnapshot = z.infer<
  typeof quoteCatalogSkuSnapshotSchema
>;

/**
 * Basket line identity + quantity for quoting.
 * Any snapshot price fields on the basket are non-authoritative for Step 10.
 */
export const quoteBasketLineInputSchema = z
  .object({
    sku_id: skuIdSchema,
    quantity: cartQuantitySchema,
    /**
     * Optional optimization-time / snapshot price — ignored for calculation.
     * Present only for stale-state tests / audit contrast.
     */
    snapshot_unit_price_minor: moneyMinorSchema.optional(),
  })
  .strict();

export type QuoteBasketLineInput = z.infer<typeof quoteBasketLineInputSchema>;

/**
 * Untrusted client/model money claims — must be ignored by the calculator.
 */
export const untrustedQuoteClaimsSchema = z
  .object({
    gross_amount_minor: z.number().optional(),
    discount_amount_minor: z.number().optional(),
    final_payable_minor: z.number().optional(),
    unit_prices: z.record(z.string(), z.number()).optional(),
  })
  .strict()
  .optional();

export type UntrustedQuoteClaims = z.infer<typeof untrustedQuoteClaimsSchema>;

/**
 * Deterministic quote calculation input (no HTTP/persistence).
 * Catalog + incentives must be backend-authoritative snapshots.
 */
export const quoteCalculationInputSchema = z
  .object({
    basket_id: z.string().min(1),
    currency: quoteCurrencySchema.default(QUOTE_CURRENCY),
    items: z.array(quoteBasketLineInputSchema),
    catalog: z.array(quoteCatalogSkuSnapshotSchema),
    incentives: z.array(quoteIncentiveInputSchema).default([]),
    /**
     * Optimization estimate — never used as final_payable authority.
     */
    practical_cost_minor: moneyMinorSchema.optional(),
    /**
     * Optional mandate ceiling for over-budget tests — quote does NOT filter
     * or authorize against it (Policy owns that later).
     */
    mandate_max_spend_minor: moneyMinorSchema.optional(),
    /** Client/LLM claims — ignored. */
    client_claims: untrustedQuoteClaimsSchema,
  })
  .strict();

export type QuoteCalculationInput = z.infer<typeof quoteCalculationInputSchema>;
export type QuoteCalculationInputRaw = z.input<
  typeof quoteCalculationInputSchema
>;

export const quoteLineResultSchema = z
  .object({
    sku_id: skuIdSchema,
    quantity: cartQuantitySchema,
    unit_price_minor: moneyMinorSchema,
    line_amount_minor: moneyMinorSchema,
  })
  .strict();

export type QuoteLineResult = z.infer<typeof quoteLineResultSchema>;

export const quoteAppliedIncentiveSchema = z
  .object({
    incentive_id: z.string().min(1),
    kind: quoteIncentiveKindSchema,
    benefit_minor: moneyMinorSchema,
  })
  .strict();

export type QuoteAppliedIncentive = z.infer<typeof quoteAppliedIncentiveSchema>;

/**
 * Authoritative quote result (Doc 08 §13.1 shape + amount_kind).
 * Separates gross / discount / final_payable — never collapses to one field.
 */
export const quoteSuccessSchema = z
  .object({
    ok: z.literal(true),
    basket_id: z.string().min(1),
    currency: quoteCurrencySchema,
    amount_kind: quoteAmountKindSchema,
    lines: z.array(quoteLineResultSchema).min(1),
    gross_amount_minor: moneyMinorSchema,
    discount_amount_minor: moneyMinorSchema,
    final_payable_minor: moneyMinorSchema,
    quote_version: z.string().min(1),
    applied_incentives: z.array(quoteAppliedIncentiveSchema),
    /**
     * Explicit non-authorization markers (Step 10 ≠ Policy/Payment).
     */
    policy_decision: z.null(),
    payment_created: z.literal(false),
    selection_created: z.literal(false),
  })
  .strict();

export type QuoteSuccess = z.infer<typeof quoteSuccessSchema>;

export const quoteFailureSchema = z
  .object({
    ok: z.literal(false),
    reason_code: quoteFailureReasonSchema,
    message: z.string().min(1),
    basket_id: z.string().min(1).nullable(),
    policy_decision: z.null(),
    payment_created: z.literal(false),
    selection_created: z.literal(false),
  })
  .strict();

export type QuoteFailure = z.infer<typeof quoteFailureSchema>;

export const quoteResultSchema = z.discriminatedUnion("ok", [
  quoteSuccessSchema,
  quoteFailureSchema,
]);

export type QuoteResult = z.infer<typeof quoteResultSchema>;
