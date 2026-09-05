import { z } from "zod";
import {
  MVP_CURRENCY,
  priceMinorSchema,
  productIdSchema,
  productStatusSchema,
  skuIdSchema,
  skuStatusSchema,
  packQuantitySchema,
  availableQuantitySchema,
  currencySchema,
} from "../catalog/schema.js";
import {
  itemNameSchema,
  targetQuantitySchema,
  requirementUnitSchema,
  minimumQualitySchema,
  constraintsJsonSchema,
  requirementIdSchema,
} from "../requirements/schema.js";
import {
  qualitySignalSchema,
  evidenceConfidenceSchema,
  evidenceIdSchema,
} from "../research/schema.js";
import {
  evidenceStatusSchema,
} from "../research/assessment-schema.js";

/**
 * Phase 5 Steps 1–9 — Optimization domain schemas.
 * Candidate feasibility, packs, quality ranking, deals, vouchers, loyalty,
 * Best Value / Best Quality baskets, and basket recommendation metadata.
 * No quote generation, user selection, policy, or payment yet.
 */

/** Locked MVP currency for optimization money fields. */
export const OPTIMIZATION_CURRENCY = MVP_CURRENCY;

/**
 * Machine-readable optimization rejection reasons (Doc 05 / Doc 10 filters).
 * Distinct from policy reason codes — policy remains final authorization.
 * Keep the taxonomy small; do not invent a large catalog.
 */
export const OPTIMIZATION_REJECTION_REASONS = [
  "OUT_OF_STOCK",
  "INACTIVE_SKU",
  "INACTIVE_PRODUCT",
  "CATEGORY_NOT_ALLOWED",
  "EXPLICITLY_EXCLUDED",
  "INVALID_QUANTITY",
  "BUDGET_EXCEEDED",
  "REQUIREMENT_NOT_FULFILLED",
  "MAX_PER_ITEM_EXCEEDED",
  "MISSING_AUTHORITATIVE_DATA",
] as const;

export type OptimizationRejectionReason =
  (typeof OPTIMIZATION_REJECTION_REASONS)[number];

export const optimizationRejectionReasonSchema = z.enum(
  OPTIMIZATION_REJECTION_REASONS,
);

/**
 * Structured constraint entries already produced by Phase 3 extraction.
 * Unknown shapes are ignored (never treated as authority).
 */
export const optimizationConstraintEntrySchema = z.union([
  z
    .object({
      type: z.literal("brand"),
      value: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("category"),
      value: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("exclusion"),
      value: z.string().min(1),
    })
    .strict(),
]);

export type OptimizationConstraintEntry = z.infer<
  typeof optimizationConstraintEntrySchema
>;

/**
 * Requirement input for optimization (Doc 05 §4 / Doc 07 §9.2).
 * Preserves Phase 3 normalized fields — not a product/SKU/price authority.
 */
export const optimizationRequirementSchema = z
  .object({
    requirement_id: requirementIdSchema.optional(),
    item_name: itemNameSchema,
    target_quantity: targetQuantitySchema,
    unit: requirementUnitSchema,
    minimum_quality: minimumQualitySchema.optional().nullable(),
    constraints_json: constraintsJsonSchema.optional(),
  })
  .strict();

export type OptimizationRequirementInput = z.input<
  typeof optimizationRequirementSchema
>;

/** Normalized requirement used by fulfillment/feasibility. */
export type OptimizationRequirement = {
  requirement_id?: string;
  item_name: string;
  target_quantity: number;
  unit: string;
  minimum_quality: string | null;
  constraints_json: unknown[];
};

export function normalizeOptimizationRequirement(
  input: OptimizationRequirementInput,
): OptimizationRequirement {
  const parsed = optimizationRequirementSchema.parse(input);
  return {
    requirement_id: parsed.requirement_id,
    item_name: parsed.item_name,
    target_quantity: parsed.target_quantity,
    unit: parsed.unit,
    minimum_quality: parsed.minimum_quality ?? null,
    constraints_json: parsed.constraints_json ?? [],
  };
}

/**
 * Authoritative catalog/SKU snapshot suitable for optimization (Doc 05 §5).
 * All commerce facts must come from backend catalog — never fabricated by AI.
 * Free-text summaries / client payable must not appear here as authority.
 */
export const optimizationCandidateSchema = z
  .object({
    product_id: productIdSchema,
    sku_id: skuIdSchema,
    product_name: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "product_name must not be empty",
      }),
    brand: z.string().min(1).nullable(),
    category_code: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "category_code must not be empty",
      }),
    product_status: productStatusSchema,
    sku_status: skuStatusSchema,
    sku_code: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "sku_code must not be empty",
      }),
    pack_quantity: packQuantitySchema,
    pack_unit: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "pack_unit must not be empty",
      }),
    /** Authoritative INR price in integer paise. */
    price_minor: priceMinorSchema,
    currency: currencySchema,
    /**
     * Authoritative stock from stock table.
     * null = no stock row (insufficient data — never invent availability).
     * 0 = out of stock.
     */
    stock_available: availableQuantitySchema.nullable(),
  })
  .strict();

export type OptimizationCandidate = z.infer<typeof optimizationCandidateSchema>;

/**
 * Hard-constraint context for candidate feasibility (Doc 05 §3.2 / §5.1).
 * Budget is a ceiling when present — not a spending target.
 * Policy remains the final authorization authority for payment.
 */
export const feasibilityContextSchema = z
  .object({
    /** Mandate allow-list; omit/empty means no category filter at this stage. */
    allowed_categories: z.array(z.string().min(1)).optional(),
    /**
     * Hard budget ceiling in integer paise for this candidate line evaluation.
     * When set, line cost (price_minor × proposed_quantity) must not exceed it.
     */
    budget_minor: priceMinorSchema.optional(),
    /** Optional mandate max-per-item ceiling (paise). */
    max_per_item_minor: priceMinorSchema.nullable().optional(),
    /**
     * Proposed purchase quantity (number of packs/SKUs).
     * Defaults to 1 when omitted. Non-positive / non-integer → INVALID_QUANTITY.
     */
    proposed_quantity: z
      .number({
        invalid_type_error: "proposed_quantity must be a number",
      })
      .finite()
      .optional(),
    /**
     * Optional requirement whose constraints (exclusion/category) apply.
     * Does not authorize payment; filters candidates before later ranking.
     */
    requirement: optimizationRequirementSchema.optional(),
  })
  .strict();

/** Parsed feasibility context. */
export type FeasibilityContext = z.infer<typeof feasibilityContextSchema>;
/** Caller input — proposed_quantity may be omitted. */
export type FeasibilityContextInput = z.input<typeof feasibilityContextSchema>;

export const feasibilityResultSchema = z
  .object({
    feasible: z.boolean(),
    rejection_reasons: z.array(optimizationRejectionReasonSchema),
    /**
     * Line cost in paise when price × quantity could be computed authoritatively.
     * null when money could not be computed (never fabricate).
     */
    line_amount_minor: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type FeasibilityResult = z.infer<typeof feasibilityResultSchema>;

/**
 * Explicit fulfillment assumptions required by locked MVP fixtures.
 * Never hide conversions; record them when applied.
 */
export const FULFILLMENT_ASSUMPTION_CODES = [
  /**
   * Requirement unit "packs" counts purchased SKU rows (1 purchase = 1 pack).
   * SKU pack_unit describes contents (grams/pieces/…) — not converted here.
   * Aligns with Phase 3 pasta "packs" requirements without inventing g→pack factors.
   */
  "PACKS_COUNT_AS_SKU_PURCHASES",
] as const;

export type FulfillmentAssumptionCode =
  (typeof FULFILLMENT_ASSUMPTION_CODES)[number];

export const fulfillmentAssumptionSchema = z
  .object({
    code: z.enum(FULFILLMENT_ASSUMPTION_CODES),
    message: z.string().min(1),
  })
  .strict();

export type FulfillmentAssumption = z.infer<typeof fulfillmentAssumptionSchema>;

export const fulfillmentOptionsSchema = z
  .object({
    /**
     * Purchase quantity (SKU packs) used to compute covered_quantity.
     * When omitted, uses the minimum positive integer packs needed to meet
     * target when units are compatible; otherwise 1.
     */
    proposed_quantity: z
      .number()
      .int()
      .positive()
      .optional(),
  })
  .strict();

export type FulfillmentOptions = z.infer<typeof fulfillmentOptionsSchema>;

/**
 * Whether a candidate can contribute toward / satisfy a structured requirement
 * (Doc 05 §4). Does not create additional products or invent conversions.
 */
export const fulfillmentResultSchema = z
  .object({
    can_contribute: z.boolean(),
    /** True when covered_quantity >= target_quantity for the evaluated purchase qty. */
    can_fulfill: z.boolean(),
    covered_quantity: z.number().finite().nonnegative().nullable(),
    proposed_quantity: z.number().int().positive(),
    rejection_reasons: z.array(optimizationRejectionReasonSchema),
    assumptions: z.array(fulfillmentAssumptionSchema),
  })
  .strict();

export type FulfillmentResult = z.infer<typeof fulfillmentResultSchema>;

/**
 * Phase 5 Step 2 — bounded pack-combination search (Doc 05 §7 / §13.2).
 * Deterministic MVP bounds: cover the seeded six-egg case without catalog-wide search.
 */
export const PACK_OPT_BOUNDS = {
  /** Max eligible SKUs considered after deterministic sort (caller should pre-filter). */
  MAX_ELIGIBLE_SKUS: 8,
  /** Max distinct SKUs in one combination (pack-combination depth). */
  MAX_DISTINCT_SKUS_PER_COMBO: 3,
  /** Max purchase count of a single SKU in one combination. */
  MAX_PACKS_PER_SKU: 12,
  /** Max total packs (sum of pack_count) in one combination. */
  MAX_TOTAL_PACKS: 12,
  /**
   * Extra packs beyond the minimum needed for coverage (single-SKU range and
   * multi-SKU exploration). Keeps excess bounded; ranking prefers smaller excess.
   */
  MAX_EXTRA_PACKS_BEYOND_MIN: 2,
  /** Max feasible combinations retained after ranking. */
  MAX_COMBINATIONS_RETURNED: 64,
  /** Hard stop on combination nodes explored during enumeration. */
  MAX_COMBINATIONS_EXPLORED: 256,
} as const;

export type PackOptBounds = typeof PACK_OPT_BOUNDS;

/**
 * Authoritative quality snapshot attached to a pack candidate.
 * Comes from research assessment — never invented; free-text summaries excluded.
 */
export const packQualitySnapshotSchema = z
  .object({
    quality_signal: qualitySignalSchema.nullable(),
    confidence: evidenceConfidenceSchema,
    evidence_refs: z.array(evidenceIdSchema),
    evidence_status: evidenceStatusSchema.nullable(),
    /**
     * Whether evidence meets the requirement minimum when material.
     * null when no minimum was supplied to the assessor.
     */
    meets_minimum_quality: z.boolean().nullable(),
  })
  .strict();

export type PackQualitySnapshot = z.infer<typeof packQualitySnapshotSchema>;

/**
 * Eligible pack for quantity/pack optimization = catalog candidate + quality.
 * price_minor is the cost of ONE pack (not per unit inside the pack).
 */
export const packCandidateInputSchema = z
  .object({
    candidate: optimizationCandidateSchema,
    quality: packQualitySnapshotSchema,
  })
  .strict();

export type PackCandidateInput = z.infer<typeof packCandidateInputSchema>;

/** One SKU line inside a pack combination (pack_count packs × price_minor each). */
export const packCombinationLineSchema = z
  .object({
    sku_id: skuIdSchema,
    product_id: productIdSchema,
    sku_code: z.string().min(1),
    /** Units contributed by ONE purchased pack toward the requirement. */
    units_per_pack: z.number().finite().positive(),
    /** Number of packs purchased (not eggs/units). */
    pack_count: z.number().int().positive(),
    /** Authoritative catalog pack_quantity (contents of one pack). */
    pack_quantity: packQuantitySchema,
    pack_unit: z.string().min(1),
    /** Authoritative price of ONE pack (paise). */
    unit_price_minor: priceMinorSchema,
    /** pack_count × unit_price_minor (paise). */
    line_amount_minor: priceMinorSchema,
    quality_signal: qualitySignalSchema.nullable(),
    confidence: evidenceConfidenceSchema,
    evidence_refs: z.array(evidenceIdSchema),
  })
  .strict();

export type PackCombinationLine = z.infer<typeof packCombinationLineSchema>;

export const packCombinationSchema = z
  .object({
    /** Deterministic key: sorted "sku_id:pack_count" joined by "|". */
    combination_key: z.string().min(1),
    lines: z.array(packCombinationLineSchema).min(1),
    target_quantity: targetQuantitySchema,
    covered_quantity: z.number().finite().nonnegative(),
    excess_quantity: z.number().finite().nonnegative(),
    pack_count_total: z.number().int().positive(),
    /** Sum of line amounts — catalog gross only (no vouchers/discounts). */
    gross_amount_minor: priceMinorSchema,
    currency: currencySchema,
    /** Conservative (lowest) quality signal across lines; null if any missing. */
    quality_signal: qualitySignalSchema.nullable(),
    /** Minimum confidence across lines. */
    confidence: evidenceConfidenceSchema,
    evidence_refs: z.array(evidenceIdSchema),
    assumptions: z.array(fulfillmentAssumptionSchema),
    feasible: z.boolean(),
    rejection_reasons: z.array(optimizationRejectionReasonSchema),
  })
  .strict();

export type PackCombination = z.infer<typeof packCombinationSchema>;

export const packOptimizationContextSchema = feasibilityContextSchema;

export type PackOptimizationContextInput = FeasibilityContextInput;

/**
 * Phase 5 Step 3 — ranking objective primitives (Doc 05 §12).
 * Basket generation is deferred; these prepare Best Value vs Best Quality orderings.
 */
export const QUALITY_RANKING_OBJECTIVES = [
  "BEST_VALUE",
  "BEST_QUALITY",
] as const;

export type QualityRankingObjective =
  (typeof QUALITY_RANKING_OBJECTIVES)[number];

export const qualityRankingObjectiveSchema = z.enum(
  QUALITY_RANKING_OBJECTIVES,
);

/**
 * Normalized quality view for explainable ranking (Phase 4 structured fields only).
 * Free-text summaries are intentionally absent.
 */
export const qualityRankingViewSchema = z
  .object({
    quality_signal: qualitySignalSchema.nullable(),
    /** Deterministic ordinal from QUALITY_SIGNAL_RANK; -1 when signal is null. */
    quality_rank: z.number().int().min(-1),
    confidence: evidenceConfidenceSchema,
    evidence_refs: z.array(evidenceIdSchema),
    /**
     * Evidence materiality from Phase 4 when known on the input snapshot.
     * null when the combination did not carry status (still preserves signal/refs).
     */
    evidence_status: evidenceStatusSchema.nullable(),
    /**
     * Hard-minimum evaluation result when a threshold was supplied.
     * null when no minimum was provided.
     */
    meets_minimum_quality: z.boolean().nullable(),
  })
  .strict();

export type QualityRankingView = z.infer<typeof qualityRankingViewSchema>;

export const qualityRankedCombinationSchema = z
  .object({
    rank_index: z.number().int().nonnegative(),
    objective: qualityRankingObjectiveSchema,
    combination: packCombinationSchema,
    quality: qualityRankingViewSchema,
  })
  .strict();

export type QualityRankedCombination = z.infer<
  typeof qualityRankedCombinationSchema
>;

/**
 * Phase 5 Step 4 — ordinary merchant deal types (Doc 05 §8).
 * Minimal MVP representation — not a generic discount platform.
 * Voucher/loyalty are explicitly excluded (Steps 5–6).
 */
export const MERCHANT_DEAL_TYPES = [
  /** No ordinary deal; catalog pack price only. */
  "NONE",
  /** Catalog price already reflects the purchasable pack/bundle price. */
  "PACK_PRICE",
  /**
   * Backend explicitly defines a realized saving amount against catalog gross.
   * Must not be inferred from list/MRP/crossed-out prices.
   */
  "BACKEND_REALIZED_SAVING",
] as const;

export type MerchantDealType = (typeof MERCHANT_DEAL_TYPES)[number];

export const merchantDealTypeSchema = z.enum(MERCHANT_DEAL_TYPES);

export const DEAL_AUTHORITY_SOURCES = [
  "CATALOG_PRICE",
  "BACKEND_DEFINED_DEAL",
] as const;

export type DealAuthoritySource = (typeof DEAL_AUTHORITY_SOURCES)[number];

export const dealAuthoritySourceSchema = z.enum(DEAL_AUTHORITY_SOURCES);

/**
 * Authoritative ordinary-merchant deal attachment for one combination.
 * Free-text descriptions are non-authoritative and omitted from this contract.
 *
 * Double-count rule: catalog gross uses current price_minor only.
 * realized_benefit_minor may reduce effective cost once when
 * deal_type === BACKEND_REALIZED_SAVING and authority === BACKEND_DEFINED_DEAL.
 * list_price_minor is never converted into a saving by itself.
 */
export const merchantDealAttachmentSchema = z
  .object({
    deal_type: merchantDealTypeSchema,
    authority: dealAuthoritySourceSchema,
    /**
     * Backend-defined realized saving in paise (optional).
     * Required for BACKEND_REALIZED_SAVING; ignored/forbidden as invented otherwise.
     */
    realized_benefit_minor: priceMinorSchema.optional(),
    /**
     * Optional list/MRP/reference price — informational only.
     * NEVER treated as realized saving without BACKEND_REALIZED_SAVING.
     */
    list_price_minor: priceMinorSchema.nullable().optional(),
    /** Stable backend reference (not free-text proof of savings). */
    source_reference: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "source_reference must not be empty",
      }),
    /** When true, excess quantity may be preferred if economics improve (Doc 05 §8). */
    material_excess_justified: z.boolean().default(false),
    /** Optional SKUs this deal applies to (empty = whole combination). */
    affected_sku_ids: z.array(skuIdSchema).optional().default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.deal_type === "BACKEND_REALIZED_SAVING") {
      if (value.authority !== "BACKEND_DEFINED_DEAL") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authority"],
          message:
            "BACKEND_REALIZED_SAVING requires authority BACKEND_DEFINED_DEAL",
        });
      }
      if (
        value.realized_benefit_minor === undefined ||
        !Number.isInteger(value.realized_benefit_minor)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["realized_benefit_minor"],
          message:
            "BACKEND_REALIZED_SAVING requires integer realized_benefit_minor",
        });
      }
    }
  });

export type MerchantDealAttachment = z.output<
  typeof merchantDealAttachmentSchema
>;
export type MerchantDealAttachmentInput = z.input<
  typeof merchantDealAttachmentSchema
>;

/**
 * Effective cost per required unit as an exact rational (no float money).
 * Compare via cross-multiplication: n1/d1 < n2/d2 iff n1*d2 < n2*d1.
 */
export const effectiveCostPerRequiredUnitSchema = z
  .object({
    numerator_minor: priceMinorSchema,
    denominator: z.number().finite().positive(),
  })
  .strict();

export type EffectiveCostPerRequiredUnit = z.infer<
  typeof effectiveCostPerRequiredUnitSchema
>;

export const dealEconomicsSchema = z
  .object({
    combination_key: z.string().min(1),
    /** Catalog gross from current authoritative pack prices. */
    gross_amount_minor: priceMinorSchema,
    /** Realized ordinary-deal benefit (0 when none / not authoritative). */
    realized_deal_benefit_minor: priceMinorSchema,
    /** gross - realized benefit; never negative. */
    effective_amount_minor: priceMinorSchema,
    target_quantity: targetQuantitySchema,
    covered_quantity: z.number().finite().nonnegative(),
    excess_quantity: z.number().finite().nonnegative(),
    effective_cost_per_required_unit: effectiveCostPerRequiredUnitSchema,
    deal_type: merchantDealTypeSchema,
    authority: dealAuthoritySourceSchema,
    source_reference: z.string().min(1),
    material_excess_justified: z.boolean(),
    quality_signal: qualitySignalSchema.nullable(),
    confidence: evidenceConfidenceSchema,
    evidence_refs: z.array(evidenceIdSchema),
    feasible: z.boolean(),
    rejection_reasons: z.array(optimizationRejectionReasonSchema),
  })
  .strict();

export type DealEconomics = z.infer<typeof dealEconomicsSchema>;

export const dealRankedCombinationSchema = z
  .object({
    rank_index: z.number().int().nonnegative(),
    objective: qualityRankingObjectiveSchema,
    combination: packCombinationSchema,
    economics: dealEconomicsSchema,
    quality: qualityRankingViewSchema,
  })
  .strict();

export type DealRankedCombination = z.infer<typeof dealRankedCombinationSchema>;

/**
 * Phase 5 Step 5 — Smart Voucher Decision (Doc 05 §9 / FR-07).
 * Minimal MVP representation — not a full incentive platform.
 * Authority is backend-defined only; free-text descriptions are non-authoritative.
 */
export const VOUCHER_DECISION_STATES = [
  "USE_NOW",
  "SAVE_FOR_LATER",
  "DO_NOT_USE",
] as const;

export type VoucherDecisionState = (typeof VOUCHER_DECISION_STATES)[number];

export const voucherDecisionStateSchema = z.enum(VOUCHER_DECISION_STATES);

export const VOUCHER_VALIDITY_STATES = [
  "VALID",
  "EXPIRED",
  "INVALID",
] as const;

export type VoucherValidityState = (typeof VOUCHER_VALIDITY_STATES)[number];

export const voucherValidityStateSchema = z.enum(VOUCHER_VALIDITY_STATES);

export const VOUCHER_ELIGIBILITY_STATES = [
  "ELIGIBLE",
  "INELIGIBLE",
] as const;

export type VoucherEligibilityState =
  (typeof VOUCHER_ELIGIBILITY_STATES)[number];

export const voucherEligibilityStateSchema = z.enum(
  VOUCHER_ELIGIBILITY_STATES,
);

export const VOUCHER_AUTHORITY_SOURCES = ["BACKEND_DEFINED_VOUCHER"] as const;

export type VoucherAuthoritySource =
  (typeof VOUCHER_AUTHORITY_SOURCES)[number];

export const voucherAuthoritySourceSchema = z.enum(VOUCHER_AUTHORITY_SOURCES);

/**
 * Structured voucher decision reasons (Doc 05 §9 / Doc 12 D-026–D-030).
 * Keep the taxonomy small; human text is derived later and is non-authoritative.
 */
export const FUTURE_VALUE_STATUSES = ["KNOWN", "UNKNOWN"] as const;

export type FutureValueStatus = (typeof FUTURE_VALUE_STATUSES)[number];

export const futureValueStatusSchema = z.enum(FUTURE_VALUE_STATUSES);

export const VOUCHER_DECISION_REASONS = [
  "VOUCHER_VALID_AND_IMMEDIATE_BENEFIT",
  "BELOW_THRESHOLD",
  "UNJUSTIFIED_THRESHOLD_EXPANSION",
  "VOUCHER_EXPIRED",
  "VOUCHER_INELIGIBLE",
  "VOUCHER_INVALID",
  "NO_IMMEDIATE_BENEFIT",
  "FUTURE_VALUE_PREFERRED",
  /** Doc 05 §9.4 — future utility could not be established authoritatively. */
  "FUTURE_VALUE_UNCERTAIN",
  "DUPLICATE_BENEFIT",
  "MISSING_AUTHORITATIVE_DATA",
  "BUDGET_CONFLICT",
  "PRIOR_CONSTRAINT_FAILED",
] as const;

export type VoucherDecisionReason = (typeof VOUCHER_DECISION_REASONS)[number];

export const voucherDecisionReasonSchema = z.enum(VOUCHER_DECISION_REASONS);

/**
 * Authoritative voucher attachment supplied by backend incentive data.
 * Discount/threshold/validity/eligibility/future-use must not be invented.
 * `description` is optional free-text and never drives the decision.
 */
export const authoritativeVoucherSchema = z
  .object({
    voucher_id: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "voucher_id must not be empty",
      }),
    authority: voucherAuthoritySourceSchema,
    source_reference: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "source_reference must not be empty",
      }),
    /**
     * Stable benefit identity for double-count protection against ordinary deals.
     * When equal to the merchant deal's benefit identity/source, reject.
     */
    benefit_identity: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "benefit_identity must not be empty",
      })
      .optional(),
    threshold_minor: priceMinorSchema,
    discount_minor: priceMinorSchema,
    /** Upstream-validated currentness — do not recompute expiry here. */
    validity: voucherValidityStateSchema,
    eligibility: voucherEligibilityStateSchema,
    /**
     * Authoritative future-use value in paise when known (Doc 05 §9.4).
     * Omit or null when unknown — never invent a future saving.
     */
    future_use_value_minor: priceMinorSchema.nullable().optional(),
    /** Non-authoritative free-text; ignored by the decision engine. */
    description: z.string().optional(),
  })
  .strict();

export type AuthoritativeVoucher = z.infer<typeof authoritativeVoucherSchema>;
export type AuthoritativeVoucherInput = z.input<
  typeof authoritativeVoucherSchema
>;

/**
 * Already-feasible basket economics after ordinary merchant deal (Step 4).
 * Voucher evaluation does not rebuild baskets or re-run quality logic.
 */
export const voucherBasketContextSchema = z
  .object({
    gross_amount_minor: priceMinorSchema,
    /** Ordinary merchant deal benefit already realized once in Step 4. */
    realized_deal_benefit_minor: priceMinorSchema,
    /** Effective amount before voucher = gross − deal (never negative). */
    effective_amount_before_voucher_minor: priceMinorSchema,
    /**
     * Amount used for voucher threshold comparison.
     * Defaults to effective_amount_before_voucher_minor when omitted.
     */
    qualifying_amount_minor: priceMinorSchema.optional(),
    /** Hard budget ceiling when present (mandate max spend). */
    budget_ceiling_minor: priceMinorSchema.optional(),
    /** Deal benefit identity/source for duplicate detection. */
    merchant_deal_benefit_identity: z.string().min(1).nullable().optional(),
    merchant_deal_source_reference: z.string().min(1).nullable().optional(),
    /** Prior Steps 1–4 feasibility; voucher cannot repair failures. */
    feasible: z.boolean(),
    prior_rejection_reasons: z
      .array(optimizationRejectionReasonSchema)
      .optional()
      .default([]),
    quality_signal: qualitySignalSchema.nullable().optional(),
    confidence: evidenceConfidenceSchema.optional(),
    evidence_refs: z.array(evidenceIdSchema).optional().default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const expected =
      value.gross_amount_minor - value.realized_deal_benefit_minor;
    if (expected !== value.effective_amount_before_voucher_minor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effective_amount_before_voucher_minor"],
        message:
          "effective_amount_before_voucher_minor must equal gross − realized deal benefit",
      });
    }
    if (value.realized_deal_benefit_minor > value.gross_amount_minor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["realized_deal_benefit_minor"],
        message: "realized_deal_benefit_minor cannot exceed gross_amount_minor",
      });
    }
  });

export type VoucherBasketContext = z.output<typeof voucherBasketContextSchema>;
export type VoucherBasketContextInput = z.input<
  typeof voucherBasketContextSchema
>;

export const voucherDecisionEconomicsSchema = z
  .object({
    gross_amount_minor: priceMinorSchema,
    realized_deal_benefit_minor: priceMinorSchema,
    effective_amount_before_voucher_minor: priceMinorSchema,
    qualifying_amount_minor: priceMinorSchema,
    threshold_minor: priceMinorSchema,
    discount_minor: priceMinorSchema,
    /** min(discount, effective_before); never exceeds basket; never negative. */
    immediate_benefit_minor: priceMinorSchema,
    /** Authoritative future-use value when supplied; null when unknown. */
    future_use_value_minor: priceMinorSchema.nullable(),
    /**
     * Immediate benefit forgone when SAVE_FOR_LATER; otherwise 0.
     * Not an invented opportunity-cost model — mirrors immediate_benefit.
     */
    opportunity_cost_minor: priceMinorSchema,
    /** Hypothetical amount after applying voucher once; never negative. */
    hypothetical_amount_after_voucher_minor: priceMinorSchema,
  })
  .strict();

export type VoucherDecisionEconomics = z.infer<
  typeof voucherDecisionEconomicsSchema
>;

export const voucherDecisionResultSchema = z
  .object({
    voucher_id: z.string().min(1),
    authority: voucherAuthoritySourceSchema,
    source_reference: z.string().min(1),
    benefit_identity: z.string().min(1).nullable(),
    decision: voucherDecisionStateSchema,
    reasons: z.array(voucherDecisionReasonSchema).min(1),
    /**
     * Whether authoritative future-use value was available (Doc 05 §9.4).
     * UNKNOWN must never fabricate future_use_value_minor.
     */
    future_value_status: futureValueStatusSchema,
    economics: voucherDecisionEconomicsSchema,
    quality_signal: qualitySignalSchema.nullable().optional(),
    confidence: evidenceConfidenceSchema.optional(),
    evidence_refs: z.array(evidenceIdSchema),
    prior_feasible: z.boolean(),
  })
  .strict();

export type VoucherDecisionResult = z.infer<typeof voucherDecisionResultSchema>;

/**
 * Phase 5 Step 6 — Loyalty Reward Decision (Doc 05 §10 / FR-08).
 * Minimal MVP reward decision — not a loyalty platform.
 * Same overall-value principle as vouchers; no invented point conversions.
 */
export const LOYALTY_DECISION_STATES = VOUCHER_DECISION_STATES;

export type LoyaltyDecisionState = VoucherDecisionState;

export const loyaltyDecisionStateSchema = voucherDecisionStateSchema;

export const LOYALTY_VALIDITY_STATES = [
  "VALID",
  "EXPIRED",
  "INVALID",
] as const;

export type LoyaltyValidityState = (typeof LOYALTY_VALIDITY_STATES)[number];

export const loyaltyValidityStateSchema = z.enum(LOYALTY_VALIDITY_STATES);

export const LOYALTY_ELIGIBILITY_STATES = [
  "ELIGIBLE",
  "INELIGIBLE",
] as const;

export type LoyaltyEligibilityState =
  (typeof LOYALTY_ELIGIBILITY_STATES)[number];

export const loyaltyEligibilityStateSchema = z.enum(
  LOYALTY_ELIGIBILITY_STATES,
);

export const LOYALTY_AUTHORITY_SOURCES = [
  "BACKEND_DEFINED_LOYALTY_REWARD",
] as const;

export type LoyaltyAuthoritySource =
  (typeof LOYALTY_AUTHORITY_SOURCES)[number];

export const loyaltyAuthoritySourceSchema = z.enum(LOYALTY_AUTHORITY_SOURCES);

/**
 * How reward value is represented authoritatively.
 * POINTS_ONLY never converts to money without a backend monetary redeemable.
 */
export const LOYALTY_VALUE_KINDS = ["MONETARY", "POINTS_ONLY"] as const;

export type LoyaltyValueKind = (typeof LOYALTY_VALUE_KINDS)[number];

export const loyaltyValueKindSchema = z.enum(LOYALTY_VALUE_KINDS);

export const LOYALTY_DECISION_REASONS = [
  "LOYALTY_VALID_AND_IMMEDIATE_BENEFIT",
  "BELOW_MINIMUM_SPEND",
  "UNJUSTIFIED_REWARD_EXPANSION",
  "LOYALTY_EXPIRED",
  "LOYALTY_INELIGIBLE",
  "LOYALTY_INVALID",
  "LOYALTY_NOT_CONSUMABLE",
  "NO_IMMEDIATE_BENEFIT",
  "FUTURE_VALUE_PREFERRED",
  "FUTURE_VALUE_UNCERTAIN",
  "REWARD_VALUE_NOT_ESTABLISHED",
  "DUPLICATE_BENEFIT",
  "MISSING_AUTHORITATIVE_DATA",
  "BUDGET_CONFLICT",
  "PRIOR_CONSTRAINT_FAILED",
] as const;

export type LoyaltyDecisionReason = (typeof LOYALTY_DECISION_REASONS)[number];

export const loyaltyDecisionReasonSchema = z.enum(LOYALTY_DECISION_REASONS);

/**
 * Authoritative loyalty reward attachment from backend incentive data.
 * Free-text description is non-authoritative.
 * Points never become money unless redeemable_value_minor is backend-defined.
 */
export const authoritativeLoyaltyRewardSchema = z
  .object({
    reward_id: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "reward_id must not be empty",
      }),
    authority: loyaltyAuthoritySourceSchema,
    source_reference: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "source_reference must not be empty",
      }),
    benefit_identity: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "benefit_identity must not be empty",
      })
      .optional(),
    value_kind: loyaltyValueKindSchema,
    /**
     * Authoritative monetary redeemable value (paise).
     * Required for MONETARY; forbidden for POINTS_ONLY (no invented conversion).
     */
    redeemable_value_minor: priceMinorSchema.optional(),
    /** Optional points balance — never converted to money by this engine. */
    points_balance: z.number().int().nonnegative().optional(),
    /** Minimum spend condition in paise; omit or 0 when none. */
    minimum_spend_minor: priceMinorSchema.optional().default(0),
    validity: loyaltyValidityStateSchema,
    eligibility: loyaltyEligibilityStateSchema,
    /** Upstream: whether the reward can actually be consumed now. */
    consumable: z.boolean(),
    /**
     * Authoritative future-use value in paise when known (Doc 05 §10).
     * Omit/null when unknown — never invent.
     */
    future_use_value_minor: priceMinorSchema.nullable().optional(),
    description: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.value_kind === "MONETARY") {
      if (
        value.redeemable_value_minor === undefined ||
        !Number.isInteger(value.redeemable_value_minor)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["redeemable_value_minor"],
          message:
            "MONETARY loyalty rewards require integer redeemable_value_minor",
        });
      }
    }
    if (
      value.value_kind === "POINTS_ONLY" &&
      value.redeemable_value_minor !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["redeemable_value_minor"],
        message:
          "POINTS_ONLY must not include redeemable_value_minor (no invented conversion)",
      });
    }
  });

export type AuthoritativeLoyaltyReward = z.output<
  typeof authoritativeLoyaltyRewardSchema
>;
export type AuthoritativeLoyaltyRewardInput = z.input<
  typeof authoritativeLoyaltyRewardSchema
>;

/**
 * Basket economics after ordinary deal + optional voucher (Steps 4–5).
 * Loyalty does not rebuild baskets or re-run quality logic.
 */
export const loyaltyBasketContextSchema = z
  .object({
    gross_amount_minor: priceMinorSchema,
    realized_deal_benefit_minor: priceMinorSchema,
    /** Voucher benefit already applied once in Step 5 (0 when none/not used). */
    voucher_benefit_minor: priceMinorSchema,
    /**
     * Effective before loyalty = gross − deal − voucher (never negative).
     */
    effective_amount_before_loyalty_minor: priceMinorSchema,
    qualifying_amount_minor: priceMinorSchema.optional(),
    budget_ceiling_minor: priceMinorSchema.optional(),
    merchant_deal_benefit_identity: z.string().min(1).nullable().optional(),
    merchant_deal_source_reference: z.string().min(1).nullable().optional(),
    voucher_benefit_identity: z.string().min(1).nullable().optional(),
    voucher_source_reference: z.string().min(1).nullable().optional(),
    /**
     * Benefit identities already claimed by other loyalty rewards in this run.
     * Used to prevent duplicate loyalty application (no stacking by default).
     */
    applied_loyalty_benefit_identities: z
      .array(z.string().min(1))
      .optional()
      .default([]),
    feasible: z.boolean(),
    prior_rejection_reasons: z
      .array(optimizationRejectionReasonSchema)
      .optional()
      .default([]),
    quality_signal: qualitySignalSchema.nullable().optional(),
    confidence: evidenceConfidenceSchema.optional(),
    evidence_refs: z.array(evidenceIdSchema).optional().default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const expected =
      value.gross_amount_minor -
      value.realized_deal_benefit_minor -
      value.voucher_benefit_minor;
    if (expected !== value.effective_amount_before_loyalty_minor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effective_amount_before_loyalty_minor"],
        message:
          "effective_amount_before_loyalty_minor must equal gross − deal − voucher",
      });
    }
    if (value.effective_amount_before_loyalty_minor < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effective_amount_before_loyalty_minor"],
        message: "effective_amount_before_loyalty_minor must be non-negative",
      });
    }
  });

export type LoyaltyBasketContext = z.output<typeof loyaltyBasketContextSchema>;
export type LoyaltyBasketContextInput = z.input<
  typeof loyaltyBasketContextSchema
>;

export const loyaltyDecisionEconomicsSchema = z
  .object({
    gross_amount_minor: priceMinorSchema,
    realized_deal_benefit_minor: priceMinorSchema,
    voucher_benefit_minor: priceMinorSchema,
    effective_amount_before_loyalty_minor: priceMinorSchema,
    qualifying_amount_minor: priceMinorSchema,
    minimum_spend_minor: priceMinorSchema,
    redeemable_value_minor: priceMinorSchema.nullable(),
    points_balance: z.number().int().nonnegative().nullable(),
    /** Capped applicable monetary benefit; null when value not established. */
    immediate_benefit_minor: priceMinorSchema.nullable(),
    future_use_value_minor: priceMinorSchema.nullable(),
    opportunity_cost_minor: priceMinorSchema,
    hypothetical_amount_after_loyalty_minor: priceMinorSchema,
  })
  .strict();

export type LoyaltyDecisionEconomics = z.infer<
  typeof loyaltyDecisionEconomicsSchema
>;

export const loyaltyDecisionResultSchema = z
  .object({
    reward_id: z.string().min(1),
    authority: loyaltyAuthoritySourceSchema,
    source_reference: z.string().min(1),
    benefit_identity: z.string().min(1).nullable(),
    value_kind: loyaltyValueKindSchema,
    decision: loyaltyDecisionStateSchema,
    reasons: z.array(loyaltyDecisionReasonSchema).min(1),
    future_value_status: futureValueStatusSchema,
    economics: loyaltyDecisionEconomicsSchema,
    quality_signal: qualitySignalSchema.nullable().optional(),
    confidence: evidenceConfidenceSchema.optional(),
    evidence_refs: z.array(evidenceIdSchema),
    prior_feasible: z.boolean(),
  })
  .strict();

export type LoyaltyDecisionResult = z.infer<typeof loyaltyDecisionResultSchema>;

/**
 * Phase 5 Step 7 — Best Value basket generation bounds (Doc 05 §13.1–13.2).
 * Bounded Stage-1/Stage-2 search; never unrestricted catalog Cartesian products.
 */
export const BEST_VALUE_BOUNDS = {
  /** Max requirements in one BEST_VALUE run. */
  MAX_REQUIREMENTS: 6,
  /** Max Stage-1 deal-ranked candidates retained per requirement. */
  MAX_CANDIDATES_PER_REQUIREMENT: 8,
  /** Hard stop on complete baskets evaluated in Stage 2. */
  MAX_COMPLETE_BASKETS_EXPLORED: 256,
  /** Max feasible complete baskets retained after ranking. */
  MAX_COMPLETE_BASKETS_RETURNED: 32,
} as const;

export type BestValueBounds = typeof BEST_VALUE_BOUNDS;

export const BASKET_TYPES = ["BEST_VALUE", "BEST_QUALITY"] as const;

export type BasketType = (typeof BASKET_TYPES)[number];

export const basketTypeSchema = z.enum(BASKET_TYPES);

/**
 * Structured BEST_VALUE explanation reasons (small taxonomy).
 * Free-text is non-authoritative and omitted.
 */
export const BEST_VALUE_EXPLANATION_REASONS = [
  "REQUIREMENTS_FULFILLED",
  "HARD_CONSTRAINTS_SATISFIED",
  "LOWEST_PRACTICAL_COST",
  "MINIMUM_QUALITY_MET",
  /**
   * Candidate practical cost is within the optimization budget ceiling.
   * Does NOT mean payment is authorized (Doc 05 / Doc 06 — policy owns that).
   */
  "OPTIMIZATION_BUDGET_FEASIBLE",
  "NO_UNNECESSARY_ITEMS",
  "INCENTIVE_USE_NOW_APPLIED",
  "INCENTIVE_PRESERVED",
] as const;

export type BestValueExplanationReason =
  (typeof BEST_VALUE_EXPLANATION_REASONS)[number];

export const bestValueExplanationReasonSchema = z.enum(
  BEST_VALUE_EXPLANATION_REASONS,
);

/** One basket line mapped to a requirement (Doc 07 §13.2). */
export const bestValueBasketItemSchema = z
  .object({
    requirement_key: z.string().min(1),
    requirement_id: z.string().min(1).nullable(),
    item_name: itemNameSchema,
    sku_id: skuIdSchema,
    product_id: productIdSchema,
    sku_code: z.string().min(1),
    quantity: z.number().int().positive(),
    unit_price_minor: priceMinorSchema,
    line_amount_minor: priceMinorSchema,
    quality_signal: qualitySignalSchema.nullable(),
    confidence: evidenceConfidenceSchema,
    evidence_refs: z.array(evidenceIdSchema),
  })
  .strict();

export type BestValueBasketItem = z.infer<typeof bestValueBasketItemSchema>;

export const bestValueIncentiveSummarySchema = z
  .object({
    voucher_decision: voucherDecisionStateSchema.nullable(),
    voucher_id: z.string().min(1).nullable(),
    voucher_benefit_minor: priceMinorSchema,
    loyalty_decision: loyaltyDecisionStateSchema.nullable(),
    reward_id: z.string().min(1).nullable(),
    loyalty_benefit_minor: priceMinorSchema,
    realized_deal_benefit_minor: priceMinorSchema,
  })
  .strict();

export type BestValueIncentiveSummary = z.infer<
  typeof bestValueIncentiveSummarySchema
>;

export const bestValueExplanationSchema = z
  .object({
    objective: z.literal("BEST_VALUE"),
    reasons: z.array(bestValueExplanationReasonSchema).min(1),
    quality_floor: qualitySignalSchema.nullable(),
    excess_quantity_total: z.number().finite().nonnegative(),
    incentive: bestValueIncentiveSummarySchema,
  })
  .strict();

export type BestValueExplanation = z.infer<typeof bestValueExplanationSchema>;

/**
 * Generated BEST_VALUE basket (optimization domain object).
 *
 * Financial boundary (Doc 05 §15 / Doc 03 Cart-Quote / Doc 06 Policy):
 * - gross_amount_minor / discount_amount_minor / practical_cost_minor are
 *   deterministic OPTIMIZATION estimates from authoritative catalog/incentive
 *   inputs.
 * - amount_kind is always PRACTICAL_OPTIMIZATION_COST — never checkout payable.
 * - Cart/Quote later recalculates authoritative final payable.
 * - Policy later authorizes (or denies) payment against mandate max spend.
 * Optimization budget feasibility ≠ payment authorization.
 */
export const bestValueBasketSchema = z
  .object({
    basket_type: z.literal("BEST_VALUE"),
    currency: currencySchema,
    items: z.array(bestValueBasketItemSchema).min(1),
    gross_amount_minor: priceMinorSchema,
    /** deal + USE_NOW voucher + USE_NOW loyalty (capped; never exceeds gross). */
    discount_amount_minor: priceMinorSchema,
    /**
     * Practical optimization cost after valid USE_NOW incentives.
     * Provisional ranking/feasibility amount only — NOT Cart/Quote final
     * payable, NOT policy-approved amount, NOT a checkout/payment amount.
     */
    practical_cost_minor: priceMinorSchema,
    /**
     * Machine-readable authority tag so practical_cost_minor cannot be
     * mistaken for final payable (Doc 05 §15).
     */
    amount_kind: z.literal("PRACTICAL_OPTIMIZATION_COST"),
    quality_signal: qualitySignalSchema.nullable(),
    confidence: evidenceConfidenceSchema,
    evidence_refs: z.array(evidenceIdSchema),
    excess_quantity_total: z.number().finite().nonnegative(),
    combination_key: z.string().min(1),
    explanation: bestValueExplanationSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.discount_amount_minor > value.gross_amount_minor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discount_amount_minor"],
        message: "discount_amount_minor cannot exceed gross_amount_minor",
      });
    }
    if (
      value.practical_cost_minor !==
      value.gross_amount_minor - value.discount_amount_minor
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["practical_cost_minor"],
        message:
          "practical_cost_minor must equal gross_amount_minor − discount_amount_minor",
      });
    }
  });

export type BestValueBasket = z.infer<typeof bestValueBasketSchema>;

export const bestValueRequirementFailureSchema = z
  .object({
    requirement_key: z.string().min(1),
    item_name: itemNameSchema,
    rejection_reasons: z.array(optimizationRejectionReasonSchema).min(1),
  })
  .strict();

export type BestValueRequirementFailure = z.infer<
  typeof bestValueRequirementFailureSchema
>;

export const bestValueInfeasibilitySchema = z
  .object({
    feasible: z.literal(false),
    rejection_reasons: z.array(optimizationRejectionReasonSchema).min(1),
    requirement_failures: z.array(bestValueRequirementFailureSchema),
    explored_count: z.number().int().nonnegative(),
    bounds: z
      .object({
        MAX_REQUIREMENTS: z.number().int().positive(),
        MAX_CANDIDATES_PER_REQUIREMENT: z.number().int().positive(),
        MAX_COMPLETE_BASKETS_EXPLORED: z.number().int().positive(),
        MAX_COMPLETE_BASKETS_RETURNED: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type BestValueInfeasibility = z.infer<
  typeof bestValueInfeasibilitySchema
>;

export const bestValueResultSchema = z.discriminatedUnion("feasible", [
  z
    .object({
      feasible: z.literal(true),
      basket: bestValueBasketSchema,
      alternatives_considered: z.number().int().nonnegative(),
      bounds: z
        .object({
          MAX_REQUIREMENTS: z.number().int().positive(),
          MAX_CANDIDATES_PER_REQUIREMENT: z.number().int().positive(),
          MAX_COMPLETE_BASKETS_EXPLORED: z.number().int().positive(),
          MAX_COMPLETE_BASKETS_RETURNED: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  bestValueInfeasibilitySchema,
]);

export type BestValueResult = z.infer<typeof bestValueResultSchema>;

/**
 * Phase 5 Step 8 — Best Quality basket (Doc 05 §11.2 / §12 / FR-10).
 * Same bounds and financial boundary as Best Value; different ranking objective.
 */
export const BEST_QUALITY_BOUNDS = BEST_VALUE_BOUNDS;

export type BestQualityBounds = typeof BEST_QUALITY_BOUNDS;

export const BEST_QUALITY_EXPLANATION_REASONS = [
  "REQUIREMENTS_FULFILLED",
  "HARD_CONSTRAINTS_SATISFIED",
  "HIGHEST_PRACTICAL_QUALITY",
  "MINIMUM_QUALITY_MET",
  "OPTIMIZATION_BUDGET_FEASIBLE",
  "NO_UNNECESSARY_ITEMS",
  "MATERIAL_QUALITY_IMPROVEMENT",
  "IMMATERIAL_QUALITY_COST_PREFERRED",
  "WEAK_EVIDENCE_NOT_TREATED_AS_PREMIUM",
  "INCENTIVE_USE_NOW_APPLIED",
  "INCENTIVE_PRESERVED",
] as const;

export type BestQualityExplanationReason =
  (typeof BEST_QUALITY_EXPLANATION_REASONS)[number];

export const bestQualityExplanationReasonSchema = z.enum(
  BEST_QUALITY_EXPLANATION_REASONS,
);

export const bestQualityExplanationSchema = z
  .object({
    objective: z.literal("BEST_QUALITY"),
    reasons: z.array(bestQualityExplanationReasonSchema).min(1),
    quality_floor: qualitySignalSchema.nullable(),
    excess_quantity_total: z.number().finite().nonnegative(),
    incentive: bestValueIncentiveSummarySchema,
  })
  .strict();

export type BestQualityExplanation = z.infer<
  typeof bestQualityExplanationSchema
>;

/**
 * Generated BEST_QUALITY basket (optimization domain object).
 * Same financial boundary as Best Value: practical_cost_minor is NOT checkout payable.
 */
export const bestQualityBasketSchema = z
  .object({
    basket_type: z.literal("BEST_QUALITY"),
    currency: currencySchema,
    items: z.array(bestValueBasketItemSchema).min(1),
    gross_amount_minor: priceMinorSchema,
    discount_amount_minor: priceMinorSchema,
    /**
     * Practical optimization cost after valid USE_NOW incentives.
     * NOT Cart/Quote final payable; NOT policy authorization.
     */
    practical_cost_minor: priceMinorSchema,
    amount_kind: z.literal("PRACTICAL_OPTIMIZATION_COST"),
    quality_signal: qualitySignalSchema.nullable(),
    confidence: evidenceConfidenceSchema,
    evidence_refs: z.array(evidenceIdSchema),
    excess_quantity_total: z.number().finite().nonnegative(),
    combination_key: z.string().min(1),
    explanation: bestQualityExplanationSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.discount_amount_minor > value.gross_amount_minor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discount_amount_minor"],
        message: "discount_amount_minor cannot exceed gross_amount_minor",
      });
    }
    if (
      value.practical_cost_minor !==
      value.gross_amount_minor - value.discount_amount_minor
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["practical_cost_minor"],
        message:
          "practical_cost_minor must equal gross_amount_minor − discount_amount_minor",
      });
    }
  });

export type BestQualityBasket = z.infer<typeof bestQualityBasketSchema>;

export const bestQualityInfeasibilitySchema = z
  .object({
    feasible: z.literal(false),
    rejection_reasons: z.array(optimizationRejectionReasonSchema).min(1),
    requirement_failures: z.array(bestValueRequirementFailureSchema),
    explored_count: z.number().int().nonnegative(),
    bounds: z
      .object({
        MAX_REQUIREMENTS: z.number().int().positive(),
        MAX_CANDIDATES_PER_REQUIREMENT: z.number().int().positive(),
        MAX_COMPLETE_BASKETS_EXPLORED: z.number().int().positive(),
        MAX_COMPLETE_BASKETS_RETURNED: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type BestQualityInfeasibility = z.infer<
  typeof bestQualityInfeasibilitySchema
>;

export const bestQualityResultSchema = z.discriminatedUnion("feasible", [
  z
    .object({
      feasible: z.literal(true),
      basket: bestQualityBasketSchema,
      alternatives_considered: z.number().int().nonnegative(),
      bounds: z
        .object({
          MAX_REQUIREMENTS: z.number().int().positive(),
          MAX_CANDIDATES_PER_REQUIREMENT: z.number().int().positive(),
          MAX_COMPLETE_BASKETS_EXPLORED: z.number().int().positive(),
          MAX_COMPLETE_BASKETS_RETURNED: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  bestQualityInfeasibilitySchema,
]);

export type BestQualityResult = z.infer<typeof bestQualityResultSchema>;

/**
 * Phase 5 Step 9 — Basket comparison & recommendation metadata (Doc 05 §14 / FR-11).
 * Preference decision between already-generated baskets — NOT authorization.
 * Does not create quotes, selection records, policy decisions, or payments.
 */

/** Explicit structured user preference for recommendation (never inferred from free text). */
export const EXPLICIT_BASKET_PREFERENCES = [
  "BEST_QUALITY",
  "BEST_VALUE",
  "NONE",
] as const;

export type ExplicitBasketPreference =
  (typeof EXPLICIT_BASKET_PREFERENCES)[number];

export const explicitBasketPreferenceSchema = z.enum(
  EXPLICIT_BASKET_PREFERENCES,
);

/**
 * Authoritative recommendation reason codes (Doc 05 §14.1).
 * Presentation prose is non-authoritative.
 */
export const RECOMMENDATION_REASON_CODES = [
  "QUALITY_PREFERENCE_ALIGNED",
  "COST_PREFERENCE_ALIGNED",
  "MATERIAL_QUALITY_ADVANTAGE",
  "ACCEPTABLE_QUALITY_WITH_LOWER_COST",
  "IMMATERIAL_QUALITY_DIFFERENCE",
  "INCENTIVE_PRESERVATION",
  "REQUIREMENT_SATISFACTION_ADVANTAGE",
  "TRADEOFF_PREFERENCE_DEPENDENT",
  "ONLY_FEASIBLE_BASKET",
  "ALTERNATIVE_UNAVAILABLE",
  "NO_FEASIBLE_BASKETS",
] as const;

export type RecommendationReasonCode =
  (typeof RECOMMENDATION_REASON_CODES)[number];

export const recommendationReasonCodeSchema = z.enum(
  RECOMMENDATION_REASON_CODES,
);

/**
 * Deterministic decision-clarity for recommendation (Doc 10).
 * Categorical decision-strength metadata — NOT a statistical probability,
 * NOT evidence confidence, NOT WEAK_CONFIDENCE_THRESHOLD.
 */
export const RECOMMENDATION_DECISION_CLARITY = [
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

export type RecommendationDecisionClarity =
  (typeof RECOMMENDATION_DECISION_CLARITY)[number];

export const recommendationDecisionClaritySchema = z.enum(
  RECOMMENDATION_DECISION_CLARITY,
);

export const recommendationIncentiveViewSchema = z
  .object({
    voucher_decision: voucherDecisionStateSchema.nullable(),
    loyalty_decision: loyaltyDecisionStateSchema.nullable(),
    /** USE_NOW benefits only; SAVE_FOR_LATER / DO_NOT_USE contribute 0. */
    current_incentive_benefit_minor: priceMinorSchema,
    preserves_future_opportunity: z.boolean(),
  })
  .strict();

export type RecommendationIncentiveView = z.infer<
  typeof recommendationIncentiveViewSchema
>;

export const recommendationTradeoffSchema = z
  .object({
    quality_signal_best_value: qualitySignalSchema.nullable(),
    quality_signal_best_quality: qualitySignalSchema.nullable(),
    quality_rank_best_value: z.number().int(),
    quality_rank_best_quality: z.number().int(),
    material_quality_difference: z.boolean(),
    practical_cost_best_value_minor: priceMinorSchema.nullable(),
    practical_cost_best_quality_minor: priceMinorSchema.nullable(),
    /**
     * Best Quality practical cost − Best Value practical cost (paise).
     * null when either basket is missing.
     */
    cost_delta_minor: z.number().int().nullable(),
    /**
     * Compared amounts are PRACTICAL_OPTIMIZATION_COST only — not checkout payable.
     */
    amount_kind: z.literal("PRACTICAL_OPTIMIZATION_COST"),
    excess_quantity_best_value: z.number().finite().nonnegative().nullable(),
    excess_quantity_best_quality: z.number().finite().nonnegative().nullable(),
    incentive_best_value: recommendationIncentiveViewSchema.nullable(),
    incentive_best_quality: recommendationIncentiveViewSchema.nullable(),
  })
  .strict();

export type RecommendationTradeoff = z.infer<
  typeof recommendationTradeoffSchema
>;

export const basketRecommendationSuccessSchema = z
  .object({
    feasible: z.literal(true),
    recommended_basket_id: z.string().min(1),
    recommended_basket_type: basketTypeSchema,
    alternative_basket_id: z.string().min(1).nullable(),
    alternative_basket_type: basketTypeSchema.nullable(),
    reason_code: recommendationReasonCodeSchema,
    reason_codes: z.array(recommendationReasonCodeSchema).min(1),
    decision_clarity: recommendationDecisionClaritySchema,
    preference_applied: explicitBasketPreferenceSchema,
    /**
     * Recommendation never locks the user into the recommended basket (FR-11).
     */
    user_may_select_alternative: z.literal(true),
    /** Step 9 does not create selection / quote / policy / payment. */
    selection_created: z.literal(false),
    quote_created: z.literal(false),
    policy_decision: z.null(),
    payment_created: z.literal(false),
    tradeoff: recommendationTradeoffSchema,
    /**
     * Concise human-readable rationale (non-authoritative).
     * reason_code / reason_codes remain authoritative.
     */
    rationale: z.string().min(1).nullable(),
  })
  .strict();

export type BasketRecommendationSuccess = z.infer<
  typeof basketRecommendationSuccessSchema
>;

export const basketRecommendationFailureSchema = z
  .object({
    feasible: z.literal(false),
    reason_code: z.literal("NO_FEASIBLE_BASKETS"),
    reason_codes: z.array(z.literal("NO_FEASIBLE_BASKETS")).min(1),
    decision_clarity: recommendationDecisionClaritySchema,
    preference_applied: explicitBasketPreferenceSchema,
    recommended_basket_id: z.null(),
    recommended_basket_type: z.null(),
    alternative_basket_id: z.null(),
    alternative_basket_type: z.null(),
    user_may_select_alternative: z.literal(true),
    selection_created: z.literal(false),
    quote_created: z.literal(false),
    policy_decision: z.null(),
    payment_created: z.literal(false),
    tradeoff: recommendationTradeoffSchema,
    rationale: z.string().min(1).nullable(),
  })
  .strict();

export type BasketRecommendationFailure = z.infer<
  typeof basketRecommendationFailureSchema
>;

export const basketRecommendationResultSchema = z.discriminatedUnion(
  "feasible",
  [basketRecommendationSuccessSchema, basketRecommendationFailureSchema],
);

export type BasketRecommendationResult = z.infer<
  typeof basketRecommendationResultSchema
>;
