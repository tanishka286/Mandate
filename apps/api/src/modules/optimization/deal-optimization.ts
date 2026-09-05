import { assertMoneyMinor, type MoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { parseMinimumQualityLabel } from "../research/assessment-schema.js";
import {
  evaluateHardMinimumQuality,
  qualityViewFromPackCombination,
  toQualityRank,
} from "./quality-ranking.js";
import {
  dealEconomicsSchema,
  dealRankedCombinationSchema,
  merchantDealAttachmentSchema,
  packCombinationSchema,
  qualityRankingObjectiveSchema,
  type DealEconomics,
  type DealRankedCombination,
  type MerchantDealAttachment,
  type MerchantDealAttachmentInput,
  type OptimizationRejectionReason,
  type PackCombination,
  type QualityRankingObjective,
} from "./schema.js";

/**
 * Phase 5 Step 4 — Deal Optimization (Doc 05 §8 / FR-06).
 *
 * Evaluates ordinary merchant catalog/pack pricing and backend-defined realized
 * deal benefits on already-built pack combinations.
 *
 * Does NOT evaluate vouchers or loyalty (Steps 5–6).
 * Does NOT invent list-price / MRP savings.
 * Does NOT create quotes or final payable.
 */

const DEFAULT_NONE_DEAL: MerchantDealAttachment = {
  deal_type: "NONE",
  authority: "CATALOG_PRICE",
  source_reference: "catalog:price_minor",
  material_excess_justified: false,
  affected_sku_ids: [],
};

/**
 * Reject voucher/loyalty payloads at the deal boundary (fail closed).
 * Those fields belong to later incentive steps.
 */
export function assertNoIncentiveFields(input: unknown): void {
  if (!input || typeof input !== "object") {
    return;
  }
  const record = input as Record<string, unknown>;
  const forbidden = [
    "voucher",
    "voucher_id",
    "voucher_decision",
    "loyalty",
    "loyalty_reward",
    "loyalty_decision",
    "USE_NOW",
    "SAVE_FOR_LATER",
    "DO_NOT_USE",
  ] as const;
  for (const key of forbidden) {
    if (key in record && record[key] !== undefined) {
      throw Object.assign(
        new Error("Voucher/loyalty fields are not consumed by deal optimization"),
        {
          code: "VALIDATION_ERROR",
          statusCode: 400,
          details: { forbidden_field: key },
        },
      );
    }
  }
}

function parseDealAttachment(
  input: MerchantDealAttachmentInput | undefined,
):
  | { ok: true; deal: MerchantDealAttachment }
  | { ok: false; reasons: OptimizationRejectionReason[] } {
  if (input === undefined) {
    return { ok: true, deal: DEFAULT_NONE_DEAL };
  }

  assertNoIncentiveFields(input);

  const parsed = merchantDealAttachmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reasons: ["MISSING_AUTHORITATIVE_DATA"] };
  }

  const deal = parsed.data;

  // Fail closed: realized benefit without proper backend authority.
  if (
    deal.realized_benefit_minor !== undefined &&
    deal.deal_type !== "BACKEND_REALIZED_SAVING"
  ) {
    return { ok: false, reasons: ["MISSING_AUTHORITATIVE_DATA"] };
  }

  if (
    deal.deal_type === "BACKEND_REALIZED_SAVING" &&
    (deal.realized_benefit_minor === undefined ||
      deal.authority !== "BACKEND_DEFINED_DEAL")
  ) {
    return { ok: false, reasons: ["MISSING_AUTHORITATIVE_DATA"] };
  }

  return { ok: true, deal };
}

/**
 * Resolve realized ordinary-deal benefit once.
 *
 * Catalog gross already uses current authoritative price_minor.
 * List/MRP/crossed-out prices never become savings by themselves.
 * A backend-defined realized_benefit_minor is applied at most once.
 */
export function resolveRealizedDealBenefit(
  grossAmountMinor: MoneyMinor,
  deal: MerchantDealAttachment,
): {
  realized_deal_benefit_minor: MoneyMinor;
  effective_amount_minor: MoneyMinor;
  rejection_reasons: OptimizationRejectionReason[];
} {
  assertMoneyMinor(grossAmountMinor, "gross_amount_minor");

  // List price alone → no saving (Doc 05 §8).
  // Even if list_price_minor > gross, do not invent a benefit.
  if (deal.deal_type === "NONE" || deal.deal_type === "PACK_PRICE") {
    return {
      realized_deal_benefit_minor: 0,
      effective_amount_minor: grossAmountMinor,
      rejection_reasons: [],
    };
  }

  if (deal.deal_type === "BACKEND_REALIZED_SAVING") {
    const benefit = assertMoneyMinor(
      deal.realized_benefit_minor ?? 0,
      "realized_benefit_minor",
    );

    // Double-count protection: benefit cannot exceed gross; applied once only.
    if (benefit > grossAmountMinor) {
      return {
        realized_deal_benefit_minor: 0,
        effective_amount_minor: grossAmountMinor,
        rejection_reasons: ["MISSING_AUTHORITATIVE_DATA"],
      };
    }

    const effective = assertMoneyMinor(
      grossAmountMinor - benefit,
      "effective_amount_minor",
    );

    // Explicit: do NOT also subtract (list_price - gross). List is ignored.
    return {
      realized_deal_benefit_minor: benefit,
      effective_amount_minor: effective,
      rejection_reasons: [],
    };
  }

  return {
    realized_deal_benefit_minor: 0,
    effective_amount_minor: grossAmountMinor,
    rejection_reasons: ["MISSING_AUTHORITATIVE_DATA"],
  };
}

/**
 * Exact rational effective cost per required unit (no floating-point money).
 */
export function effectiveCostPerRequiredUnit(
  effectiveAmountMinor: MoneyMinor,
  targetQuantity: number,
): { numerator_minor: MoneyMinor; denominator: number } {
  assertMoneyMinor(effectiveAmountMinor, "effective_amount_minor");
  if (!(Number.isFinite(targetQuantity) && targetQuantity > 0)) {
    throw Object.assign(new Error("target_quantity must be positive"), {
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }
  return {
    numerator_minor: effectiveAmountMinor,
    denominator: targetQuantity,
  };
}

/** Compare a/b vs c/d without floats: a/b < c/d iff a*d < c*b. */
export function compareEffectiveCostPerRequiredUnit(
  left: { numerator_minor: number; denominator: number },
  right: { numerator_minor: number; denominator: number },
): number {
  if (
    Number.isInteger(left.denominator) &&
    Number.isInteger(right.denominator)
  ) {
    const l = BigInt(left.numerator_minor) * BigInt(right.denominator);
    const r = BigInt(right.numerator_minor) * BigInt(left.denominator);
    if (l < r) return -1;
    if (l > r) return 1;
    return 0;
  }

  // Deterministic fallback for non-integer denominators: scale by 1e6.
  const leftDen = BigInt(Math.round(left.denominator * 1_000_000));
  const rightDen = BigInt(Math.round(right.denominator * 1_000_000));
  const l = BigInt(left.numerator_minor) * rightDen;
  const r = BigInt(right.numerator_minor) * leftDen;
  if (l < r) return -1;
  if (l > r) return 1;
  return 0;
}

/**
 * Evaluate ordinary-deal economics for one pack combination.
 */
export function evaluateDealEconomics(
  combinationInput: PackCombination,
  dealInput?: MerchantDealAttachmentInput,
): DealEconomics {
  assertNoIncentiveFields(dealInput);
  const combination = parseOrThrow(packCombinationSchema, combinationInput);
  const dealResult = parseDealAttachment(dealInput);

  const reasons: OptimizationRejectionReason[] = [];

  if (!combination.feasible) {
    reasons.push(
      ...(combination.rejection_reasons.length > 0
        ? combination.rejection_reasons
        : (["REQUIREMENT_NOT_FULFILLED"] as OptimizationRejectionReason[])),
    );
  }

  if (combination.covered_quantity < combination.target_quantity) {
    reasons.push("REQUIREMENT_NOT_FULFILLED");
  }

  let deal = DEFAULT_NONE_DEAL;
  if (!dealResult.ok) {
    reasons.push(...dealResult.reasons);
  } else {
    deal = dealResult.deal;
  }

  const gross = assertMoneyMinor(
    combination.gross_amount_minor,
    "gross_amount_minor",
  );

  const resolved = resolveRealizedDealBenefit(gross, deal);
  reasons.push(...resolved.rejection_reasons);

  const perUnit = effectiveCostPerRequiredUnit(
    resolved.effective_amount_minor,
    combination.target_quantity,
  );

  const uniqueReasons = [...new Set(reasons)];

  return parseOrThrow(dealEconomicsSchema, {
    combination_key: combination.combination_key,
    gross_amount_minor: gross,
    realized_deal_benefit_minor: resolved.realized_deal_benefit_minor,
    effective_amount_minor: resolved.effective_amount_minor,
    target_quantity: combination.target_quantity,
    covered_quantity: combination.covered_quantity,
    excess_quantity: combination.excess_quantity,
    effective_cost_per_required_unit: perUnit,
    deal_type: deal.deal_type,
    authority: deal.authority,
    source_reference: deal.source_reference,
    material_excess_justified: deal.material_excess_justified,
    quality_signal: combination.quality_signal,
    confidence: combination.confidence,
    evidence_refs: [...combination.evidence_refs].sort((a, b) =>
      a.localeCompare(b),
    ),
    feasible: uniqueReasons.length === 0,
    rejection_reasons: uniqueReasons,
  });
}

function hasUnjustifiedExcess(economics: DealEconomics): boolean {
  return (
    economics.excess_quantity > 0 && !economics.material_excess_justified
  );
}

function sortedSkuKey(combination: PackCombination): string {
  return combination.lines
    .map((line) => line.sku_id)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join(",");
}

/**
 * Deal-aware BEST_VALUE (Doc 05 §8 + §12):
 * 1. Prefer combinations without unjustified excess quantity
 * 2. Lower effective_amount_minor (after ordinary deal benefit)
 * 3. Higher quality_rank
 * 4. Lower excess_quantity
 * 5. Higher confidence
 * 6. SKU / combination_key tie-break
 */
export function compareDealBestValue(
  a: { combination: PackCombination; economics: DealEconomics },
  b: { combination: PackCombination; economics: DealEconomics },
): number {
  const aBad = hasUnjustifiedExcess(a.economics);
  const bBad = hasUnjustifiedExcess(b.economics);
  if (aBad !== bBad) {
    return aBad ? 1 : -1;
  }

  if (
    a.economics.effective_amount_minor !== b.economics.effective_amount_minor
  ) {
    return (
      a.economics.effective_amount_minor - b.economics.effective_amount_minor
    );
  }

  const rankA = toQualityRank(a.combination.quality_signal);
  const rankB = toQualityRank(b.combination.quality_signal);
  if (rankA !== rankB) {
    return rankB - rankA;
  }

  if (a.economics.excess_quantity !== b.economics.excess_quantity) {
    return a.economics.excess_quantity - b.economics.excess_quantity;
  }

  if (a.combination.confidence !== b.combination.confidence) {
    return a.combination.confidence > b.combination.confidence ? -1 : 1;
  }

  const skuCmp = sortedSkuKey(a.combination).localeCompare(
    sortedSkuKey(b.combination),
  );
  if (skuCmp !== 0) {
    return skuCmp;
  }

  return a.combination.combination_key.localeCompare(
    b.combination.combination_key,
  );
}

/**
 * Deal-aware BEST_QUALITY:
 * 1. Higher quality
 * 2. Higher confidence
 * 3. Prefer no unjustified excess
 * 4. Lower effective_amount_minor
 * 5. Lower excess
 * 6. SKU / key tie-break
 */
export function compareDealBestQuality(
  a: { combination: PackCombination; economics: DealEconomics },
  b: { combination: PackCombination; economics: DealEconomics },
): number {
  const rankA = toQualityRank(a.combination.quality_signal);
  const rankB = toQualityRank(b.combination.quality_signal);
  if (rankA !== rankB) {
    return rankB - rankA;
  }

  if (a.combination.confidence !== b.combination.confidence) {
    return a.combination.confidence > b.combination.confidence ? -1 : 1;
  }

  const aBad = hasUnjustifiedExcess(a.economics);
  const bBad = hasUnjustifiedExcess(b.economics);
  if (aBad !== bBad) {
    return aBad ? 1 : -1;
  }

  if (
    a.economics.effective_amount_minor !== b.economics.effective_amount_minor
  ) {
    return (
      a.economics.effective_amount_minor - b.economics.effective_amount_minor
    );
  }

  if (a.economics.excess_quantity !== b.economics.excess_quantity) {
    return a.economics.excess_quantity - b.economics.excess_quantity;
  }

  const skuCmp = sortedSkuKey(a.combination).localeCompare(
    sortedSkuKey(b.combination),
  );
  if (skuCmp !== 0) {
    return skuCmp;
  }

  return a.combination.combination_key.localeCompare(
    b.combination.combination_key,
  );
}

export type DealOptimizationInput = {
  combinations: readonly PackCombination[];
  /**
   * Optional ordinary-merchant deal attachments keyed by combination_key.
   * Missing key → NONE (catalog price only).
   */
  deals_by_combination_key?: ReadonlyMap<
    string,
    MerchantDealAttachmentInput
  >;
  objective?: QualityRankingObjective;
  minimum_quality?: string | null;
  /** Hard budget ceiling applied to effective_amount_minor. */
  budget_minor?: number;
};

export type DealOptimizationResult = {
  objective: QualityRankingObjective;
  ranked: DealRankedCombination[];
  rejected: Array<{
    combination: PackCombination;
    economics: DealEconomics | null;
    rejection_reasons: OptimizationRejectionReason[];
  }>;
};

/**
 * Optimize ordinary deals over pack combinations and rank deterministically.
 * Hard constraints remain filters. Vouchers/loyalty are not evaluated.
 */
export function optimizeDeals(
  input: DealOptimizationInput,
): DealOptimizationResult {
  const objective = parseOrThrow(
    qualityRankingObjectiveSchema,
    input.objective ?? "BEST_VALUE",
  );

  const minimumLabel =
    input.minimum_quality === undefined ? null : input.minimum_quality;

  const rankedPool: Array<{
    combination: PackCombination;
    economics: DealEconomics;
  }> = [];
  const rejected: DealOptimizationResult["rejected"] = [];

  for (const raw of input.combinations) {
    const combination = parseOrThrow(packCombinationSchema, raw);
    const dealAttachment = input.deals_by_combination_key?.get(
      combination.combination_key,
    );

    let economics: DealEconomics;
    try {
      economics = evaluateDealEconomics(combination, dealAttachment);
    } catch (error) {
      const reasons: OptimizationRejectionReason[] = [
        "MISSING_AUTHORITATIVE_DATA",
      ];
      rejected.push({
        combination,
        economics: null,
        rejection_reasons: reasons,
      });
      void error;
      continue;
    }

    const reasons: OptimizationRejectionReason[] = [
      ...economics.rejection_reasons,
    ];

    if (!economics.feasible) {
      // already in reasons
    }

    const hardQuality = evaluateHardMinimumQuality(
      combination.quality_signal,
      minimumLabel,
    );
    if (!hardQuality.meets) {
      reasons.push(...hardQuality.rejection_reasons);
    }

    if (
      input.budget_minor !== undefined &&
      economics.effective_amount_minor > input.budget_minor
    ) {
      reasons.push("BUDGET_EXCEEDED");
    }

    // Deal cannot resurrect an infeasible combination.
    if (!combination.feasible) {
      reasons.push(
        ...(combination.rejection_reasons.length > 0
          ? combination.rejection_reasons
          : (["REQUIREMENT_NOT_FULFILLED"] as OptimizationRejectionReason[])),
      );
    }

    const uniqueReasons = [...new Set(reasons)];
    if (uniqueReasons.length > 0) {
      rejected.push({
        combination,
        economics,
        rejection_reasons: uniqueReasons,
      });
      continue;
    }

    rankedPool.push({ combination, economics });
  }

  const sorted = rankedPool.slice().sort((a, b) => {
    const cmp =
      objective === "BEST_QUALITY"
        ? compareDealBestQuality(a, b)
        : compareDealBestValue(a, b);
    if (cmp !== 0) {
      return cmp;
    }
    return a.combination.combination_key.localeCompare(
      b.combination.combination_key,
    );
  });

  const minimumSignal =
    minimumLabel === null || minimumLabel === undefined
      ? null
      : parseMinimumQualityLabel(minimumLabel);

  const ranked: DealRankedCombination[] = sorted.map((row, index) => {
    const quality = qualityViewFromPackCombination(row.combination, {
      minimum_quality: minimumSignal,
    });
    return parseOrThrow(dealRankedCombinationSchema, {
      rank_index: index,
      objective,
      combination: row.combination,
      economics: row.economics,
      quality,
    });
  });

  return { objective, ranked, rejected };
}
