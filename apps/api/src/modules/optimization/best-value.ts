import { assertMoneyMinor, type MoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import type { QualitySignal } from "../research/schema.js";
import { compareDealBestValue, evaluateDealEconomics } from "./deal-optimization.js";
import { evaluateLoyaltyDecision } from "./loyalty-decision.js";
import { optimizePackCombinations } from "./pack-optimization.js";
import {
  evaluateHardMinimumQuality,
  toQualityRank,
} from "./quality-ranking.js";
import {
  BEST_VALUE_BOUNDS,
  bestValueBasketSchema,
  bestValueResultSchema,
  normalizeOptimizationRequirement,
  type AuthoritativeLoyaltyRewardInput,
  type AuthoritativeVoucherInput,
  type BestValueBasket,
  type BestValueBasketItem,
  type BestValueExplanationReason,
  type BestValueResult,
  type DealEconomics,
  type MerchantDealAttachmentInput,
  type OptimizationRejectionReason,
  type OptimizationRequirement,
  type OptimizationRequirementInput,
  type PackCandidateInput,
  type PackCombination,
  type PackOptimizationContextInput,
} from "./schema.js";
import { evaluateVoucherDecision } from "./voucher-decision.js";

/**
 * Phase 5 Step 7 — Best Value Basket Generation (Doc 05 §11–§13 / FR-09).
 *
 * Two-stage composition over Steps 1–6:
 * Stage 1: bounded pack + deal candidates per requirement.
 * Stage 2: combine into complete baskets, apply voucher/loyalty, rank BEST_VALUE.
 *
 * Financial boundary (Doc 05 §15 / Doc 03 / Doc 06):
 * - budget_minor is a HARD optimization ceiling (provisional feasibility).
 * - practical_cost_minor is an optimization estimate for ranking/filtering.
 * - This module does NOT recalculate Cart/Quote final payable.
 * - This module does NOT authorize payment (no policy ALLOW/DENY).
 * - Later: Cart/Quote recalculates → Policy evaluates final payable vs mandate.
 *
 * Does NOT implement Best Quality, recommendation, quote, policy, payment, or HTTP.
 */

export type BestValueRequirementSlot = {
  requirement: OptimizationRequirementInput;
  pack_candidates: readonly PackCandidateInput[];
  /** Optional ordinary deal applied uniformly to this requirement's combos. */
  deal?: MerchantDealAttachmentInput;
};

export type BestValueInput = {
  requirements: readonly BestValueRequirementSlot[];
  /**
   * Authorized budget ceiling used as a HARD optimization feasibility bound.
   * Candidates whose practical optimization economics exceed this are rejected.
   * Does NOT constitute Cart/Quote recalculation or policy payment authorization.
   */
  budget_minor: number;
  pack_context?: PackOptimizationContextInput;
  vouchers?: readonly AuthoritativeVoucherInput[];
  loyalty_rewards?: readonly AuthoritativeLoyaltyRewardInput[];
};

type Stage1Choice = {
  requirement_key: string;
  requirement: OptimizationRequirement;
  combination: PackCombination;
  economics: DealEconomics;
};

function requirementKey(
  requirement: OptimizationRequirement,
  index: number,
): string {
  if (requirement.requirement_id && requirement.requirement_id.trim().length > 0) {
    return requirement.requirement_id;
  }
  return `req:${index}:${requirement.item_name}`;
}

function uniqueReasons(
  reasons: readonly OptimizationRejectionReason[],
): OptimizationRejectionReason[] {
  return [...new Set(reasons)];
}

function intPow(base: number, exp: number): number {
  let result = 1;
  for (let i = 0; i < exp; i += 1) {
    result *= base;
  }
  return result;
}

/**
 * Deterministic per-requirement Stage-1 retention so Stage-2 product stays bounded.
 */
export function stage1CandidatesPerRequirement(requirementCount: number): number {
  if (requirementCount <= 0) {
    return 0;
  }
  let k = BEST_VALUE_BOUNDS.MAX_CANDIDATES_PER_REQUIREMENT;
  while (
    k > 1 &&
    intPow(k, requirementCount) > BEST_VALUE_BOUNDS.MAX_COMPLETE_BASKETS_EXPLORED
  ) {
    k -= 1;
  }
  return k;
}

function worstQuality(
  signals: readonly (QualitySignal | null)[],
): QualitySignal | null {
  if (signals.length === 0) {
    return null;
  }
  let worst: QualitySignal | null = signals[0] ?? null;
  let worstRank = toQualityRank(worst);
  for (const signal of signals) {
    const rank = toQualityRank(signal);
    if (rank < worstRank) {
      worst = signal;
      worstRank = rank;
    }
  }
  return worst;
}

function minConfidence(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let min = values[0]!;
  for (const value of values) {
    if (value < min) {
      min = value;
    }
  }
  return min;
}

function mergeEvidenceRefs(lists: readonly (readonly string[])[]): string[] {
  const set = new Set<string>();
  for (const list of lists) {
    for (const id of list) {
      set.add(id);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function stage1ForRequirement(
  slot: BestValueRequirementSlot,
  index: number,
  context: PackOptimizationContextInput,
  keep: number,
):
  | { ok: true; choices: Stage1Choice[] }
  | {
      ok: false;
      requirement_key: string;
      item_name: string;
      rejection_reasons: OptimizationRejectionReason[];
    } {
  const requirement = normalizeOptimizationRequirement(slot.requirement);
  const key = requirementKey(requirement, index);

  const packResult = optimizePackCombinations(
    slot.requirement,
    slot.pack_candidates,
    context,
  );

  const feasibleCombos = packResult.ranked.filter((c) => c.feasible);
  if (feasibleCombos.length === 0) {
    const reasons = uniqueReasons([
      ...packResult.ineligible.flatMap((i) => i.rejection_reasons),
      ...packResult.rejected_combinations.flatMap((c) => c.rejection_reasons),
      "REQUIREMENT_NOT_FULFILLED",
    ]);
    return {
      ok: false,
      requirement_key: key,
      item_name: requirement.item_name,
      rejection_reasons: reasons.length > 0 ? reasons : ["REQUIREMENT_NOT_FULFILLED"],
    };
  }

  const scored: Stage1Choice[] = [];
  for (const combination of feasibleCombos) {
    const hardQuality = evaluateHardMinimumQuality(
      combination.quality_signal,
      requirement.minimum_quality,
    );
    if (!hardQuality.meets) {
      continue;
    }

    let economics: DealEconomics;
    try {
      economics = evaluateDealEconomics(combination, slot.deal);
    } catch {
      continue;
    }
    if (!economics.feasible) {
      continue;
    }

    scored.push({
      requirement_key: key,
      requirement,
      combination,
      economics,
    });
  }

  if (scored.length === 0) {
    return {
      ok: false,
      requirement_key: key,
      item_name: requirement.item_name,
      rejection_reasons: ["REQUIREMENT_NOT_FULFILLED"],
    };
  }

  scored.sort((a, b) =>
    compareDealBestValue(
      { combination: a.combination, economics: a.economics },
      { combination: b.combination, economics: b.economics },
    ),
  );

  return { ok: true, choices: scored.slice(0, keep) };
}

function cartesianProduct<T>(lists: readonly (readonly T[])[]): T[][] {
  if (lists.length === 0) {
    return [];
  }
  let acc: T[][] = [[]];
  for (const list of lists) {
    const next: T[][] = [];
    for (const prefix of acc) {
      for (const item of list) {
        next.push([...prefix, item]);
      }
    }
    acc = next;
  }
  return acc;
}

function buildItems(choices: readonly Stage1Choice[]): BestValueBasketItem[] {
  const items: BestValueBasketItem[] = [];
  for (const choice of choices) {
    for (const line of choice.combination.lines) {
      items.push({
        requirement_key: choice.requirement_key,
        requirement_id: choice.requirement.requirement_id ?? null,
        item_name: choice.requirement.item_name,
        sku_id: line.sku_id,
        product_id: line.product_id,
        sku_code: line.sku_code,
        quantity: line.pack_count,
        unit_price_minor: line.unit_price_minor,
        line_amount_minor: line.line_amount_minor,
        quality_signal: line.quality_signal,
        confidence: line.confidence,
        evidence_refs: [...line.evidence_refs].sort((a, b) =>
          a.localeCompare(b),
        ),
      });
    }
  }
  items.sort((a, b) => {
    const req = a.requirement_key.localeCompare(b.requirement_key);
    if (req !== 0) return req;
    return a.sku_id.localeCompare(b.sku_id);
  });
  return items;
}

function basketCombinationKey(choices: readonly Stage1Choice[]): string {
  return choices
    .map((c) => `${c.requirement_key}=>${c.combination.combination_key}`)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join("||");
}

type EvaluatedBasket = {
  basket: BestValueBasket;
  incentive_usefulness_minor: MoneyMinor;
  quality_rank: number;
};

function evaluateCompleteBasket(
  choices: readonly Stage1Choice[],
  input: BestValueInput,
): EvaluatedBasket | null {
  const budget = assertMoneyMinor(input.budget_minor, "budget_minor");

  let gross = 0;
  let dealBenefit = 0;
  let excess = 0;
  const qualities: (QualitySignal | null)[] = [];
  const confidences: number[] = [];
  const evidenceLists: string[][] = [];
  const dealIdentities: string[] = [];
  const dealSources: string[] = [];

  for (const choice of choices) {
    if (choice.combination.covered_quantity < choice.combination.target_quantity) {
      return null;
    }
    const hardQuality = evaluateHardMinimumQuality(
      choice.combination.quality_signal,
      choice.requirement.minimum_quality,
    );
    if (!hardQuality.meets) {
      return null;
    }

    gross = assertMoneyMinor(
      gross + choice.economics.gross_amount_minor,
      "gross_amount_minor",
    );
    dealBenefit = assertMoneyMinor(
      dealBenefit + choice.economics.realized_deal_benefit_minor,
      "realized_deal_benefit_minor",
    );
    excess += choice.combination.excess_quantity;
    qualities.push(choice.combination.quality_signal);
    confidences.push(choice.combination.confidence);
    evidenceLists.push(choice.combination.evidence_refs);
    dealSources.push(choice.economics.source_reference);
    if (choice.economics.realized_deal_benefit_minor > 0) {
      dealIdentities.push(choice.economics.source_reference);
    }
  }

  if (dealBenefit > gross) {
    return null;
  }

  const beforeVoucher = assertMoneyMinor(
    gross - dealBenefit,
    "effective_amount_before_voucher_minor",
  );

  // Provisional optimization budget ceiling (hard constraint for candidate
  // feasibility). Post-deal practical economics must not intentionally exceed
  // the known authorized budget. This is NOT payment authorization — Cart/Quote
  // recalculates final payable; Policy later evaluates mandate max spend.
  if (beforeVoucher > budget) {
    return null;
  }

  let voucherBenefit = 0;
  let voucherDecision: EvaluatedBasket["basket"]["explanation"]["incentive"]["voucher_decision"] =
    null;
  let voucherId: string | null = null;
  let voucherIdentity: string | null = null;
  let voucherSource: string | null = null;

  const vouchers = input.vouchers ?? [];
  if (vouchers.length > 0) {
    const voucherEvals = vouchers.map((voucher) =>
      evaluateVoucherDecision({
        basket: {
          gross_amount_minor: gross,
          realized_deal_benefit_minor: dealBenefit,
          effective_amount_before_voucher_minor: beforeVoucher,
          budget_ceiling_minor: budget,
          merchant_deal_benefit_identity:
            dealIdentities.length > 0 ? dealIdentities[0]! : null,
          merchant_deal_source_reference:
            dealSources.length > 0 ? dealSources[0]! : null,
          feasible: true,
          prior_rejection_reasons: [],
          quality_signal: worstQuality(qualities),
          confidence: minConfidence(confidences),
          evidence_refs: mergeEvidenceRefs(evidenceLists),
        },
        voucher,
      }),
    );
    voucherEvals.sort((a, b) => a.voucher_id.localeCompare(b.voucher_id));
    // Prefer USE_NOW with highest immediate benefit; else first sorted for metadata.
    const useNow = voucherEvals
      .filter((v) => v.decision === "USE_NOW")
      .sort(
        (a, b) =>
          b.economics.immediate_benefit_minor -
            a.economics.immediate_benefit_minor ||
          a.voucher_id.localeCompare(b.voucher_id),
      );
    const selected =
      useNow[0] ??
      voucherEvals.find((v) => v.decision === "SAVE_FOR_LATER") ??
      voucherEvals[0]!;
    voucherDecision = selected.decision;
    voucherId = selected.voucher_id;
    voucherIdentity = selected.benefit_identity;
    voucherSource = selected.source_reference;
    if (selected.decision === "USE_NOW") {
      voucherBenefit = selected.economics.immediate_benefit_minor;
    }
  }

  const beforeLoyalty = assertMoneyMinor(
    beforeVoucher - voucherBenefit,
    "effective_amount_before_loyalty_minor",
  );

  let loyaltyBenefit = 0;
  let loyaltyDecision: EvaluatedBasket["basket"]["explanation"]["incentive"]["loyalty_decision"] =
    null;
  let rewardId: string | null = null;

  const rewards = input.loyalty_rewards ?? [];
  if (rewards.length > 0) {
    const loyaltyEvals = rewards.map((reward) =>
      evaluateLoyaltyDecision({
        basket: {
          gross_amount_minor: gross,
          realized_deal_benefit_minor: dealBenefit,
          voucher_benefit_minor: voucherBenefit,
          effective_amount_before_loyalty_minor: beforeLoyalty,
          budget_ceiling_minor: budget,
          merchant_deal_benefit_identity:
            dealIdentities.length > 0 ? dealIdentities[0]! : null,
          merchant_deal_source_reference:
            dealSources.length > 0 ? dealSources[0]! : null,
          voucher_benefit_identity: voucherIdentity,
          voucher_source_reference: voucherSource,
          applied_loyalty_benefit_identities: [],
          feasible: true,
          prior_rejection_reasons: [],
          quality_signal: worstQuality(qualities),
          confidence: minConfidence(confidences),
          evidence_refs: mergeEvidenceRefs(evidenceLists),
        },
        reward,
      }),
    );
    loyaltyEvals.sort((a, b) => a.reward_id.localeCompare(b.reward_id));
    const useNow = loyaltyEvals
      .filter((r) => r.decision === "USE_NOW")
      .sort((a, b) => {
        const aImm = a.economics.immediate_benefit_minor ?? 0;
        const bImm = b.economics.immediate_benefit_minor ?? 0;
        return bImm - aImm || a.reward_id.localeCompare(b.reward_id);
      });
    const selected =
      useNow[0] ??
      loyaltyEvals.find((r) => r.decision === "SAVE_FOR_LATER") ??
      loyaltyEvals[0]!;
    loyaltyDecision = selected.decision;
    rewardId = selected.reward_id;
    if (
      selected.decision === "USE_NOW" &&
      selected.economics.immediate_benefit_minor !== null
    ) {
      loyaltyBenefit = selected.economics.immediate_benefit_minor;
    }
  }

  const discount = assertMoneyMinor(
    dealBenefit + voucherBenefit + loyaltyBenefit,
    "discount_amount_minor",
  );
  if (discount > gross) {
    return null;
  }
  const practical = assertMoneyMinor(
    gross - discount,
    "practical_cost_minor",
  );

  if (practical > budget) {
    return null;
  }

  const items = buildItems(choices);
  if (items.length === 0) {
    return null;
  }
  for (const item of items) {
    if (!(item.quantity > 0)) {
      return null;
    }
  }

  const qualityFloor = worstQuality(qualities);
  const confidence = minConfidence(confidences);
  const evidence_refs = mergeEvidenceRefs(evidenceLists);

  const reasons: BestValueExplanationReason[] = [
    "REQUIREMENTS_FULFILLED",
    "HARD_CONSTRAINTS_SATISFIED",
    "LOWEST_PRACTICAL_COST",
    "MINIMUM_QUALITY_MET",
    "OPTIMIZATION_BUDGET_FEASIBLE",
    "NO_UNNECESSARY_ITEMS",
  ];
  if (voucherBenefit > 0 || loyaltyBenefit > 0) {
    reasons.push("INCENTIVE_USE_NOW_APPLIED");
  }
  if (
    voucherDecision === "SAVE_FOR_LATER" ||
    loyaltyDecision === "SAVE_FOR_LATER"
  ) {
    reasons.push("INCENTIVE_PRESERVED");
  }

  const basket = parseOrThrow(bestValueBasketSchema, {
    basket_type: "BEST_VALUE",
    currency: "INR",
    items,
    gross_amount_minor: gross,
    discount_amount_minor: discount,
    practical_cost_minor: practical,
    amount_kind: "PRACTICAL_OPTIMIZATION_COST",
    quality_signal: qualityFloor,
    confidence,
    evidence_refs,
    excess_quantity_total: excess,
    combination_key: basketCombinationKey(choices),
    explanation: {
      objective: "BEST_VALUE",
      reasons,
      quality_floor: qualityFloor,
      excess_quantity_total: excess,
      incentive: {
        voucher_decision: voucherDecision,
        voucher_id: voucherId,
        voucher_benefit_minor: voucherBenefit,
        loyalty_decision: loyaltyDecision,
        reward_id: rewardId,
        loyalty_benefit_minor: loyaltyBenefit,
        realized_deal_benefit_minor: dealBenefit,
      },
    },
  });

  return {
    basket,
    incentive_usefulness_minor: assertMoneyMinor(
      voucherBenefit + loyaltyBenefit,
      "incentive_usefulness_minor",
    ),
    quality_rank: toQualityRank(qualityFloor),
  };
}

/**
 * Doc 05 §12 Best Value ranking (lexicographic, not opaque scalar):
 * 1. lower practical_cost_minor
 * 2. higher quality_rank
 * 3. lower excess
 * 4. higher incentive usefulness (USE_NOW benefits)
 * 5. higher confidence (lower uncertainty)
 * 6. combination_key ascending
 */
export function compareBestValueBaskets(
  a: EvaluatedBasket,
  b: EvaluatedBasket,
): number {
  if (a.basket.practical_cost_minor !== b.basket.practical_cost_minor) {
    return a.basket.practical_cost_minor - b.basket.practical_cost_minor;
  }
  if (a.quality_rank !== b.quality_rank) {
    return b.quality_rank - a.quality_rank;
  }
  if (a.basket.excess_quantity_total !== b.basket.excess_quantity_total) {
    return a.basket.excess_quantity_total - b.basket.excess_quantity_total;
  }
  if (a.incentive_usefulness_minor !== b.incentive_usefulness_minor) {
    return b.incentive_usefulness_minor - a.incentive_usefulness_minor;
  }
  if (a.basket.confidence !== b.basket.confidence) {
    return b.basket.confidence - a.basket.confidence;
  }
  return a.basket.combination_key.localeCompare(b.basket.combination_key);
}

/**
 * Generate the deterministic BEST_VALUE basket for the given requirements.
 */
export function generateBestValueBasket(input: BestValueInput): BestValueResult {
  assertMoneyMinor(input.budget_minor, "budget_minor");

  if (input.requirements.length === 0) {
    return parseOrThrow(bestValueResultSchema, {
      feasible: false,
      rejection_reasons: ["REQUIREMENT_NOT_FULFILLED"],
      requirement_failures: [],
      explored_count: 0,
      bounds: { ...BEST_VALUE_BOUNDS },
    });
  }

  if (input.requirements.length > BEST_VALUE_BOUNDS.MAX_REQUIREMENTS) {
    return parseOrThrow(bestValueResultSchema, {
      feasible: false,
      rejection_reasons: ["MISSING_AUTHORITATIVE_DATA"],
      requirement_failures: [],
      explored_count: 0,
      bounds: { ...BEST_VALUE_BOUNDS },
    });
  }

  const context = input.pack_context ?? {};
  const keep = stage1CandidatesPerRequirement(input.requirements.length);
  const stage1Slots: Stage1Choice[][] = [];
  const requirementFailures: Array<{
    requirement_key: string;
    item_name: string;
    rejection_reasons: OptimizationRejectionReason[];
  }> = [];

  // Deterministic requirement order by item_name (then original index).
  const indexed = input.requirements.map((slot, index) => ({ slot, index }));
  indexed.sort((a, b) => {
    const reqA = normalizeOptimizationRequirement(a.slot.requirement);
    const reqB = normalizeOptimizationRequirement(b.slot.requirement);
    const byName = reqA.item_name.localeCompare(reqB.item_name);
    if (byName !== 0) {
      return byName;
    }
    const idA = reqA.requirement_id ?? "";
    const idB = reqB.requirement_id ?? "";
    const byId = idA.localeCompare(idB);
    if (byId !== 0) {
      return byId;
    }
    return a.index - b.index;
  });

  for (let sortedIndex = 0; sortedIndex < indexed.length; sortedIndex += 1) {
    const { slot } = indexed[sortedIndex]!;
    // Use sortedIndex so keys are independent of caller array order.
    const stage1 = stage1ForRequirement(slot, sortedIndex, context, keep);
    if (!stage1.ok) {
      requirementFailures.push({
        requirement_key: stage1.requirement_key,
        item_name: stage1.item_name,
        rejection_reasons: stage1.rejection_reasons,
      });
      continue;
    }
    stage1Slots.push(stage1.choices);
  }

  if (requirementFailures.length > 0 || stage1Slots.length !== indexed.length) {
    const reasons = uniqueReasons(
      requirementFailures.flatMap((f) => f.rejection_reasons),
    );
    return parseOrThrow(bestValueResultSchema, {
      feasible: false,
      rejection_reasons:
        reasons.length > 0 ? reasons : ["REQUIREMENT_NOT_FULFILLED"],
      requirement_failures: requirementFailures,
      explored_count: 0,
      bounds: { ...BEST_VALUE_BOUNDS },
    });
  }

  const products = cartesianProduct(stage1Slots);
  const evaluated: EvaluatedBasket[] = [];
  let explored = 0;

  for (const combo of products) {
    if (explored >= BEST_VALUE_BOUNDS.MAX_COMPLETE_BASKETS_EXPLORED) {
      break;
    }
    explored += 1;
    const result = evaluateCompleteBasket(combo, input);
    if (result) {
      evaluated.push(result);
    }
  }

  if (evaluated.length === 0) {
    return parseOrThrow(bestValueResultSchema, {
      feasible: false,
      rejection_reasons: ["BUDGET_EXCEEDED"],
      requirement_failures: [],
      explored_count: explored,
      bounds: { ...BEST_VALUE_BOUNDS },
    });
  }

  evaluated.sort(compareBestValueBaskets);
  const winner = evaluated[0]!;

  return parseOrThrow(bestValueResultSchema, {
    feasible: true,
    basket: winner.basket,
    alternatives_considered: Math.min(
      evaluated.length,
      BEST_VALUE_BOUNDS.MAX_COMPLETE_BASKETS_RETURNED,
    ),
    bounds: { ...BEST_VALUE_BOUNDS },
  });
}
