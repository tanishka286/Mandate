import { assertMoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import type { QualitySignal } from "../research/schema.js";
import { toQualityRank } from "./quality-ranking.js";
import {
  basketRecommendationResultSchema,
  type BestQualityBasket,
  type BestValueBasket,
  type BestValueIncentiveSummary,
  type BasketRecommendationResult,
  type ExplicitBasketPreference,
  type RecommendationDecisionClarity,
  type RecommendationIncentiveView,
  type RecommendationReasonCode,
  type RecommendationTradeoff,
} from "./schema.js";

/**
 * Phase 5 Step 9 — Basket Comparison & Recommendation Metadata (Doc 05 §14 / FR-11).
 *
 * Compares already-generated Best Value and Best Quality baskets.
 * Preference decision only — NOT financial authorization, quote, selection, or payment.
 *
 * Does NOT regenerate baskets, invent evidence, or create authoritative payable.
 */

export type BasketRecommendationInput = {
  best_value: BestValueBasket | null;
  best_quality: BestQualityBasket | null;
  /**
   * Explicit structured preference only.
   * Do not pass free-text; do not invent preference from unrelated text.
   */
  explicit_preference?: ExplicitBasketPreference | null;
  /**
   * Optional stable IDs. When omitted, derived deterministically from
   * basket_type + combination_key (no timestamps / randomness).
   */
  best_value_basket_id?: string | null;
  best_quality_basket_id?: string | null;
};

function normalizePreference(
  preference: ExplicitBasketPreference | null | undefined,
): ExplicitBasketPreference {
  if (
    preference === "BEST_QUALITY" ||
    preference === "BEST_VALUE" ||
    preference === "NONE"
  ) {
    return preference;
  }
  return "NONE";
}

export function deriveBasketId(
  basket: BestValueBasket | BestQualityBasket,
): string {
  return `${basket.basket_type}:${basket.combination_key}`;
}

function incentiveView(
  incentive: BestValueIncentiveSummary,
): RecommendationIncentiveView {
  const voucherPreserved = incentive.voucher_decision === "SAVE_FOR_LATER";
  const loyaltyPreserved = incentive.loyalty_decision === "SAVE_FOR_LATER";
  // SAVE_FOR_LATER / DO_NOT_USE never count as current savings.
  const voucherCurrent =
    incentive.voucher_decision === "USE_NOW"
      ? incentive.voucher_benefit_minor
      : 0;
  const loyaltyCurrent =
    incentive.loyalty_decision === "USE_NOW"
      ? incentive.loyalty_benefit_minor
      : 0;
  return {
    voucher_decision: incentive.voucher_decision,
    loyalty_decision: incentive.loyalty_decision,
    current_incentive_benefit_minor: assertMoneyMinor(
      voucherCurrent + loyaltyCurrent,
      "current_incentive_benefit_minor",
    ),
    preserves_future_opportunity: voucherPreserved || loyaltyPreserved,
  };
}

function buildTradeoff(
  bv: BestValueBasket | null,
  bq: BestQualityBasket | null,
): RecommendationTradeoff {
  const rankBv = bv ? toQualityRank(bv.quality_signal) : -1;
  const rankBq = bq ? toQualityRank(bq.quality_signal) : -1;
  const costBv = bv ? bv.practical_cost_minor : null;
  const costBq = bq ? bq.practical_cost_minor : null;
  let costDelta: number | null = null;
  if (costBv !== null && costBq !== null) {
    costDelta = costBq - costBv;
  }

  return {
    quality_signal_best_value: bv?.quality_signal ?? null,
    quality_signal_best_quality: bq?.quality_signal ?? null,
    quality_rank_best_value: rankBv,
    quality_rank_best_quality: rankBq,
    material_quality_difference:
      bv !== null && bq !== null && rankBq !== rankBv,
    practical_cost_best_value_minor: costBv,
    practical_cost_best_quality_minor: costBq,
    cost_delta_minor: costDelta,
    amount_kind: "PRACTICAL_OPTIMIZATION_COST",
    excess_quantity_best_value: bv?.excess_quantity_total ?? null,
    excess_quantity_best_quality: bq?.excess_quantity_total ?? null,
    incentive_best_value: bv ? incentiveView(bv.explanation.incentive) : null,
    incentive_best_quality: bq
      ? incentiveView(bq.explanation.incentive)
      : null,
  };
}

function formatSignal(signal: QualitySignal | null): string {
  return signal ?? "unknown";
}

function buildRationale(args: {
  recommendedType: "BEST_VALUE" | "BEST_QUALITY" | null;
  reason: RecommendationReasonCode;
  tradeoff: RecommendationTradeoff;
  hasAlternative: boolean;
}): string {
  const { recommendedType, reason, tradeoff, hasAlternative } = args;
  const delta = tradeoff.cost_delta_minor;
  const deltaText =
    delta === null
      ? ""
      : delta > 0
        ? `Best Quality costs ₹${(delta / 100).toFixed(2)} more in practical optimization cost.`
        : delta < 0
          ? `Best Quality costs ₹${((-delta) / 100).toFixed(2)} less in practical optimization cost.`
          : "Practical optimization costs are equal.";

  const qualityText = `Best Value quality ${formatSignal(tradeoff.quality_signal_best_value)}; Best Quality quality ${formatSignal(tradeoff.quality_signal_best_quality)}.`;

  const choiceNote = hasAlternative
    ? " You may still choose the alternative; recommendation is not authorization."
    : "";

  switch (reason) {
    case "NO_FEASIBLE_BASKETS":
      return "No feasible Best Value or Best Quality basket is available to recommend.";
    case "ONLY_FEASIBLE_BASKET":
    case "ALTERNATIVE_UNAVAILABLE":
      return `Only ${recommendedType === "BEST_QUALITY" ? "Best Quality" : "Best Value"} is available; the alternative basket was not generated.${choiceNote}`;
    case "QUALITY_PREFERENCE_ALIGNED":
      return `Recommended Best Quality to align with your explicit quality preference. ${qualityText} ${deltaText}${choiceNote}`;
    case "COST_PREFERENCE_ALIGNED":
      return `Recommended Best Value to align with your explicit cost preference while keeping acceptable quality. ${qualityText} ${deltaText}${choiceNote}`;
    case "MATERIAL_QUALITY_ADVANTAGE":
      return `Best Quality provides a materially stronger quality signal. ${qualityText} ${deltaText}${choiceNote}`;
    case "ACCEPTABLE_QUALITY_WITH_LOWER_COST":
      return `Best Value maintains acceptable quality at lower practical optimization cost. ${qualityText} ${deltaText}${choiceNote}`;
    case "IMMATERIAL_QUALITY_DIFFERENCE":
      return `Quality is materially equivalent; Best Value is preferred at lower or equal practical optimization cost. ${qualityText} ${deltaText}${choiceNote}`;
    case "REQUIREMENT_SATISFACTION_ADVANTAGE":
      return `Recommended ${recommendedType === "BEST_QUALITY" ? "Best Quality" : "Best Value"} for materially better structured requirement coverage.${choiceNote}`;
    case "INCENTIVE_PRESERVATION":
      return `Recommended the basket that preserves a future incentive opportunity when current savings are not decisive. ${deltaText}${choiceNote}`;
    case "TRADEOFF_PREFERENCE_DEPENDENT":
      return `Trade-off is preference-dependent. ${qualityText} ${deltaText}${choiceNote}`;
    default:
      return `Recommended ${recommendedType ?? "none"}.${choiceNote}`;
  }
}

type Decision = {
  recommended: "BEST_VALUE" | "BEST_QUALITY";
  reason: RecommendationReasonCode;
  secondary: RecommendationReasonCode[];
  decision_clarity: RecommendationDecisionClarity;
};

function hasMaterialQualityAdvantage(
  bv: BestValueBasket,
  bq: BestQualityBasket,
): boolean {
  return toQualityRank(bq.quality_signal) > toQualityRank(bv.quality_signal);
}

function qualityRanksEqual(
  bv: BestValueBasket,
  bq: BestQualityBasket,
): boolean {
  return toQualityRank(bq.quality_signal) === toQualityRank(bv.quality_signal);
}

/**
 * Distinct requirement keys covered by basket line items (existing structured data).
 * Does not recompute fulfillment or invent coverage from excess.
 */
function coveredRequirementKeys(
  basket: BestValueBasket | BestQualityBasket,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const item of basket.items) {
    keys.add(item.requirement_key);
  }
  return keys;
}

/**
 * Genuine material requirement-satisfaction advantage from structured item
 * coverage only (Doc 05 §14.1 vs §4.1 / §12).
 *
 * Lower excess_quantity_total is NOT requirement satisfaction.
 * Incomplete baskets are normally excluded by Steps 7–8; this only fires when
 * one basket's items cover a strict superset of the other's requirement keys.
 */
function hasMaterialRequirementSatisfactionAdvantage(
  candidate: BestValueBasket | BestQualityBasket,
  other: BestValueBasket | BestQualityBasket,
): boolean {
  const candidateKeys = coveredRequirementKeys(candidate);
  const otherKeys = coveredRequirementKeys(other);
  if (candidateKeys.size <= otherKeys.size) {
    return false;
  }
  for (const key of otherKeys) {
    if (!candidateKeys.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Doc 05 §14.1 priority over already-generated baskets.
 * Does not mutate baskets or invent quality/cost facts from free text.
 */
function decideBoth(
  bv: BestValueBasket,
  bq: BestQualityBasket,
  preference: ExplicitBasketPreference,
): Decision {
  // 1. Honor explicit user quality / cost preferences.
  if (preference === "BEST_QUALITY") {
    const secondary: RecommendationReasonCode[] = [];
    if (hasMaterialQualityAdvantage(bv, bq)) {
      secondary.push("MATERIAL_QUALITY_ADVANTAGE");
    } else if (qualityRanksEqual(bv, bq)) {
      secondary.push("IMMATERIAL_QUALITY_DIFFERENCE");
      secondary.push("TRADEOFF_PREFERENCE_DEPENDENT");
    }
    return {
      recommended: "BEST_QUALITY",
      reason: "QUALITY_PREFERENCE_ALIGNED",
      secondary,
      decision_clarity: "HIGH",
    };
  }

  if (preference === "BEST_VALUE") {
    const secondary: RecommendationReasonCode[] = [];
    if (hasMaterialQualityAdvantage(bv, bq)) {
      secondary.push("TRADEOFF_PREFERENCE_DEPENDENT");
    } else if (qualityRanksEqual(bv, bq)) {
      secondary.push("IMMATERIAL_QUALITY_DIFFERENCE");
    }
    return {
      recommended: "BEST_VALUE",
      reason: "COST_PREFERENCE_ALIGNED",
      secondary,
      decision_clarity: "HIGH",
    };
  }

  // 2. Prefer materially better requirement satisfaction ONLY when structured
  // item coverage shows a genuine difference — never from excess alone.
  if (hasMaterialRequirementSatisfactionAdvantage(bv, bq)) {
    return {
      recommended: "BEST_VALUE",
      reason: "REQUIREMENT_SATISFACTION_ADVANTAGE",
      secondary: [],
      decision_clarity: "HIGH",
    };
  }
  if (hasMaterialRequirementSatisfactionAdvantage(bq, bv)) {
    return {
      recommended: "BEST_QUALITY",
      reason: "REQUIREMENT_SATISFACTION_ADVANTAGE",
      secondary: [],
      decision_clarity: "HIGH",
    };
  }

  const materialQuality = hasMaterialQualityAdvantage(bv, bq);
  const bqCostsMore = bq.practical_cost_minor > bv.practical_cost_minor;
  const bvCostsMore = bv.practical_cost_minor > bq.practical_cost_minor;

  // 3–4. Quality / cost trade-off (no explicit preference).
  // Both baskets are already optimization-feasible; do not invent a numeric
  // “comfortably within mandate” margin.
  if (materialQuality) {
    return {
      recommended: "BEST_QUALITY",
      reason: "MATERIAL_QUALITY_ADVANTAGE",
      secondary: bqCostsMore ? ["TRADEOFF_PREFERENCE_DEPENDENT"] : [],
      decision_clarity: bqCostsMore ? "MEDIUM" : "HIGH",
    };
  }

  if (toQualityRank(bv.quality_signal) > toQualityRank(bq.quality_signal)) {
    // Unusual: BV has higher quality signal — prefer lower practical cost.
    if (!bvCostsMore) {
      return {
        recommended: "BEST_VALUE",
        reason: "ACCEPTABLE_QUALITY_WITH_LOWER_COST",
        secondary: [],
        decision_clarity: "HIGH",
      };
    }
  }

  // Immaterial quality difference → prefer Best Value (Doc 05 §14.1 / §11.2).
  if (qualityRanksEqual(bv, bq)) {
    if (bqCostsMore || bv.practical_cost_minor === bq.practical_cost_minor) {
      return {
        recommended: "BEST_VALUE",
        reason: bqCostsMore
          ? "IMMATERIAL_QUALITY_DIFFERENCE"
          : "ACCEPTABLE_QUALITY_WITH_LOWER_COST",
        secondary:
          bv.practical_cost_minor === bq.practical_cost_minor
            ? ["TRADEOFF_PREFERENCE_DEPENDENT"]
            : [],
        decision_clarity:
          bv.practical_cost_minor === bq.practical_cost_minor ? "LOW" : "HIGH",
      };
    }
    // BQ cheaper with same quality → prefer BQ on cost (no invented preference).
    if (bvCostsMore) {
      return {
        recommended: "BEST_QUALITY",
        reason: "ACCEPTABLE_QUALITY_WITH_LOWER_COST",
        secondary: ["IMMATERIAL_QUALITY_DIFFERENCE"],
        decision_clarity: "HIGH",
      };
    }
  }

  // 5. Incentive preservation when current saving is not decisive (tie-break).
  // SAVE_FOR_LATER / DO_NOT_USE never count as current saving.
  const bvInc = incentiveView(bv.explanation.incentive);
  const bqInc = incentiveView(bq.explanation.incentive);
  const bvPreserves = bvInc.preserves_future_opportunity;
  const bqPreserves = bqInc.preserves_future_opportunity;
  const bvWeakCurrent = bvInc.current_incentive_benefit_minor === 0;
  const bqWeakCurrent = bqInc.current_incentive_benefit_minor === 0;

  if (bvPreserves && !bqPreserves && bqWeakCurrent) {
    return {
      recommended: "BEST_VALUE",
      reason: "INCENTIVE_PRESERVATION",
      secondary: ["TRADEOFF_PREFERENCE_DEPENDENT"],
      decision_clarity: "MEDIUM",
    };
  }
  if (bqPreserves && !bvPreserves && bvWeakCurrent) {
    return {
      recommended: "BEST_QUALITY",
      reason: "INCENTIVE_PRESERVATION",
      secondary: ["TRADEOFF_PREFERENCE_DEPENDENT"],
      decision_clarity: "MEDIUM",
    };
  }

  // 6. Excess may break remaining ties as a secondary optimization signal
  // (Doc 05 §4.1 / §12) — never as requirement-satisfaction advantage.
  if (bv.excess_quantity_total !== bq.excess_quantity_total) {
    const preferValue = bv.excess_quantity_total < bq.excess_quantity_total;
    return {
      recommended: preferValue ? "BEST_VALUE" : "BEST_QUALITY",
      reason: "TRADEOFF_PREFERENCE_DEPENDENT",
      secondary: ["ACCEPTABLE_QUALITY_WITH_LOWER_COST"],
      decision_clarity: "LOW",
    };
  }

  // Deterministic final tie → Best Value.
  return {
    recommended: "BEST_VALUE",
    reason: "TRADEOFF_PREFERENCE_DEPENDENT",
    secondary: ["ACCEPTABLE_QUALITY_WITH_LOWER_COST"],
    decision_clarity: "LOW",
  };
}

/**
 * Compare Best Value vs Best Quality and produce recommendation metadata.
 * Never mutates input baskets. Never creates quote/selection/policy/payment.
 */
export function recommendBasket(
  input: BasketRecommendationInput,
): BasketRecommendationResult {
  const preference = normalizePreference(input.explicit_preference);
  const bv = input.best_value;
  const bq = input.best_quality;
  const tradeoff = buildTradeoff(bv, bq);

  if (bv === null && bq === null) {
    return parseOrThrow(basketRecommendationResultSchema, {
      feasible: false,
      reason_code: "NO_FEASIBLE_BASKETS",
      reason_codes: ["NO_FEASIBLE_BASKETS"],
      decision_clarity: "LOW",
      preference_applied: preference,
      recommended_basket_id: null,
      recommended_basket_type: null,
      alternative_basket_id: null,
      alternative_basket_type: null,
      user_may_select_alternative: true,
      selection_created: false,
      quote_created: false,
      policy_decision: null,
      payment_created: false,
      tradeoff,
      rationale: buildRationale({
        recommendedType: null,
        reason: "NO_FEASIBLE_BASKETS",
        tradeoff,
        hasAlternative: false,
      }),
    });
  }

  const bvId =
    input.best_value_basket_id?.trim() || (bv ? deriveBasketId(bv) : null);
  const bqId =
    input.best_quality_basket_id?.trim() || (bq ? deriveBasketId(bq) : null);

  if (bv !== null && bq === null) {
    return parseOrThrow(basketRecommendationResultSchema, {
      feasible: true,
      recommended_basket_id: bvId!,
      recommended_basket_type: "BEST_VALUE",
      alternative_basket_id: null,
      alternative_basket_type: null,
      reason_code: "ONLY_FEASIBLE_BASKET",
      reason_codes: ["ONLY_FEASIBLE_BASKET", "ALTERNATIVE_UNAVAILABLE"],
      decision_clarity: "HIGH",
      preference_applied: preference,
      user_may_select_alternative: true,
      selection_created: false,
      quote_created: false,
      policy_decision: null,
      payment_created: false,
      tradeoff,
      rationale: buildRationale({
        recommendedType: "BEST_VALUE",
        reason: "ALTERNATIVE_UNAVAILABLE",
        tradeoff,
        hasAlternative: false,
      }),
    });
  }

  if (bq !== null && bv === null) {
    return parseOrThrow(basketRecommendationResultSchema, {
      feasible: true,
      recommended_basket_id: bqId!,
      recommended_basket_type: "BEST_QUALITY",
      alternative_basket_id: null,
      alternative_basket_type: null,
      reason_code: "ONLY_FEASIBLE_BASKET",
      reason_codes: ["ONLY_FEASIBLE_BASKET", "ALTERNATIVE_UNAVAILABLE"],
      decision_clarity: "HIGH",
      preference_applied: preference,
      user_may_select_alternative: true,
      selection_created: false,
      quote_created: false,
      policy_decision: null,
      payment_created: false,
      tradeoff,
      rationale: buildRationale({
        recommendedType: "BEST_QUALITY",
        reason: "ALTERNATIVE_UNAVAILABLE",
        tradeoff,
        hasAlternative: false,
      }),
    });
  }

  // Both present.
  const decision = decideBoth(bv!, bq!, preference);
  const reasonCodes = [decision.reason, ...decision.secondary].filter(
    (code, index, arr) => arr.indexOf(code) === index,
  );

  const recommendedId =
    decision.recommended === "BEST_VALUE" ? bvId! : bqId!;
  const alternativeId =
    decision.recommended === "BEST_VALUE" ? bqId! : bvId!;
  const alternativeType =
    decision.recommended === "BEST_VALUE" ? "BEST_QUALITY" : "BEST_VALUE";

  return parseOrThrow(basketRecommendationResultSchema, {
    feasible: true,
    recommended_basket_id: recommendedId,
    recommended_basket_type: decision.recommended,
    alternative_basket_id: alternativeId,
    alternative_basket_type: alternativeType,
    reason_code: decision.reason,
    reason_codes: reasonCodes,
    decision_clarity: decision.decision_clarity,
    preference_applied: preference,
    user_may_select_alternative: true,
    selection_created: false,
    quote_created: false,
    policy_decision: null,
    payment_created: false,
    tradeoff,
    rationale: buildRationale({
      recommendedType: decision.recommended,
      reason: decision.reason,
      tradeoff,
      hasAlternative: true,
    }),
  });
}
