import { assertMoneyMinor, type MoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import type { EvidenceStatus } from "../research/assessment-schema.js";
import type { QualitySignal } from "../research/schema.js";
import {
  stage1CandidatesPerRequirement,
  type BestValueInput,
  type BestValueRequirementSlot,
} from "./best-value.js";
import { evaluateDealEconomics } from "./deal-optimization.js";
import { evaluateLoyaltyDecision } from "./loyalty-decision.js";
import { optimizePackCombinations } from "./pack-optimization.js";
import {
  evaluateHardMinimumQuality,
  toQualityRank,
} from "./quality-ranking.js";
import {
  BEST_QUALITY_BOUNDS,
  bestQualityBasketSchema,
  bestQualityResultSchema,
  normalizeOptimizationRequirement,
  type BestQualityBasket,
  type BestQualityExplanationReason,
  type BestQualityResult,
  type BestValueBasketItem,
  type DealEconomics,
  type OptimizationRejectionReason,
  type OptimizationRequirement,
  type PackCandidateInput,
  type PackCombination,
  type PackOptimizationContextInput,
} from "./schema.js";
import { evaluateVoucherDecision } from "./voucher-decision.js";

/**
 * Phase 5 Step 8 — Best Quality Basket Generation (Doc 05 §11.2 / §12 / FR-10).
 *
 * Same candidate universe and Stage 1–6 pipeline as Best Value.
 * Different objective: maximize meaningful quality/reliability within budget.
 *
 * Financial boundary (same as Step 7):
 * - practical_cost_minor is PRACTICAL_OPTIMIZATION_COST only
 * - Not Cart/Quote final payable; not policy authorization
 *
 * Does NOT implement recommendation, quote, policy, payment, or Step 9+.
 */

export type BestQualityRequirementSlot = BestValueRequirementSlot;
export type BestQualityInput = BestValueInput;

type Stage1Choice = {
  requirement_key: string;
  requirement: OptimizationRequirement;
  combination: PackCombination;
  economics: DealEconomics;
  /**
   * Conservative Phase 4 / Step 3 evidence_status across combination lines.
   * null when pack snapshots did not supply status (signal+confidence only).
   */
  evidence_status: EvidenceStatus | null;
};

type EvaluatedBasket = {
  basket: BestQualityBasket;
  incentive_usefulness_minor: MoneyMinor;
  /**
   * Step 3 quality_rank used for material comparison / Doc 05 §12 key #2.
   * Unsupported evidence_status → no material quality claim (toQualityRank null).
   */
  ranking_quality_rank: number;
  /** Raw toQualityRank(quality_signal) for audit / explanation only. */
  raw_quality_rank: number;
  confidence: number;
  evidence_status: EvidenceStatus | null;
};

function requirementKey(
  requirement: OptimizationRequirement,
  index: number,
): string {
  if (
    requirement.requirement_id &&
    requirement.requirement_id.trim().length > 0
  ) {
    return requirement.requirement_id;
  }
  return `req:${index}:${requirement.item_name}`;
}

function uniqueReasons(
  reasons: readonly OptimizationRejectionReason[],
): OptimizationRejectionReason[] {
  return [...new Set(reasons)];
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

/**
 * Whether Phase 4 evidence_status supports a material quality claim.
 * Reuses locked Step 3 / Phase 4 semantics (evidence_sufficient ≡ SUFFICIENT).
 * Does not invent numeric confidence thresholds in Best Quality.
 */
export function evidenceSupportsMaterialQualityClaim(
  evidenceStatus: EvidenceStatus | null,
): boolean {
  if (evidenceStatus === null) {
    // Status omitted → Step 3 signal+confidence path (no invented demotion).
    return true;
  }
  return evidenceStatus === "SUFFICIENT";
}

/**
 * Ranking quality ordinal for Best Quality (Doc 05 §12 / Step 3).
 * Uses toQualityRank(quality_signal) when evidence supports the claim;
 * WEAK / NONE / CONFLICTING → no material quality claim (rank of null).
 * Confidence remains a separate lexicographic key (lower uncertainty).
 */
export function rankingQualityRankForBestQuality(
  signal: QualitySignal | null,
  evidenceStatus: EvidenceStatus | null,
): number {
  if (!evidenceSupportsMaterialQualityClaim(evidenceStatus)) {
    return toQualityRank(null);
  }
  return toQualityRank(signal);
}

/**
 * Material quality improvement: ranking quality ranks differ (Step 3 ordinals).
 * Same ranking rank ⇒ materially similar ⇒ prefer lower practical cost.
 */
export function hasMaterialQualityImprovement(
  higher: { ranking_quality_rank: number },
  lower: { ranking_quality_rank: number },
): boolean {
  return higher.ranking_quality_rank > lower.ranking_quality_rank;
}

/**
 * Conservative evidence_status across pack lines (fail closed on weakness).
 */
function conservativeEvidenceStatus(
  statuses: readonly (EvidenceStatus | null)[],
): EvidenceStatus | null {
  if (statuses.length === 0) {
    return null;
  }
  if (statuses.some((s) => s === "WEAK")) {
    return "WEAK";
  }
  if (statuses.some((s) => s === "CONFLICTING")) {
    return "CONFLICTING";
  }
  if (statuses.some((s) => s === "NONE")) {
    return "NONE";
  }
  const known = statuses.filter((s): s is EvidenceStatus => s !== null);
  if (known.length === 0) {
    return null;
  }
  if (known.every((s) => s === "SUFFICIENT")) {
    return "SUFFICIENT";
  }
  return null;
}

function evidenceStatusForCombination(
  combination: PackCombination,
  packCandidates: readonly PackCandidateInput[],
): EvidenceStatus | null {
  const bySku = new Map(
    packCandidates.map((p) => [p.candidate.sku_id, p.quality.evidence_status]),
  );
  const statuses: (EvidenceStatus | null)[] = [];
  for (const line of combination.lines) {
    statuses.push(bySku.get(line.sku_id) ?? null);
  }
  return conservativeEvidenceStatus(statuses);
}

function sortedSkuKey(combination: PackCombination): string {
  return combination.lines
    .map((line) => line.sku_id)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join(",");
}

/**
 * Stage-1 retention order for Best Quality: Step 3 quality semantics + deals.
 * Evidence-unsupported signals do not outrank supported lower signals.
 */
function compareStage1BestQuality(a: Stage1Choice, b: Stage1Choice): number {
  const rankA = rankingQualityRankForBestQuality(
    a.combination.quality_signal,
    a.evidence_status,
  );
  const rankB = rankingQualityRankForBestQuality(
    b.combination.quality_signal,
    b.evidence_status,
  );
  if (rankA !== rankB) {
    return rankB - rankA;
  }

  if (a.combination.confidence !== b.combination.confidence) {
    return a.combination.confidence > b.combination.confidence ? -1 : 1;
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

function stage1ForRequirement(
  slot: BestQualityRequirementSlot,
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
      rejection_reasons:
        reasons.length > 0 ? reasons : ["REQUIREMENT_NOT_FULFILLED"],
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
      evidence_status: evidenceStatusForCombination(
        combination,
        slot.pack_candidates,
      ),
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

  // Stage 1 retains high-quality candidates first (same universe as BV, different order).
  scored.sort(compareStage1BestQuality);

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

function evaluateCompleteBasket(
  choices: readonly Stage1Choice[],
  input: BestQualityInput,
): EvaluatedBasket | null {
  const budget = assertMoneyMinor(input.budget_minor, "budget_minor");

  let gross = 0;
  let dealBenefit = 0;
  let excess = 0;
  const qualities: (QualitySignal | null)[] = [];
  const confidences: number[] = [];
  const evidenceLists: string[][] = [];
  const evidenceStatuses: (EvidenceStatus | null)[] = [];
  const dealIdentities: string[] = [];
  const dealSources: string[] = [];

  for (const choice of choices) {
    if (
      choice.combination.covered_quantity < choice.combination.target_quantity
    ) {
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
    evidenceStatuses.push(choice.evidence_status);
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

  // Provisional optimization budget ceiling — not payment authorization.
  if (beforeVoucher > budget) {
    return null;
  }

  let voucherBenefit = 0;
  let voucherDecision: BestQualityBasket["explanation"]["incentive"]["voucher_decision"] =
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
  let loyaltyDecision: BestQualityBasket["explanation"]["incentive"]["loyalty_decision"] =
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
  const practical = assertMoneyMinor(gross - discount, "practical_cost_minor");
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
  const evidence_status = conservativeEvidenceStatus(evidenceStatuses);
  const rawRank = toQualityRank(qualityFloor);
  const rankingRank = rankingQualityRankForBestQuality(
    qualityFloor,
    evidence_status,
  );

  const reasons: BestQualityExplanationReason[] = [
    "REQUIREMENTS_FULFILLED",
    "HARD_CONSTRAINTS_SATISFIED",
    "HIGHEST_PRACTICAL_QUALITY",
    "MINIMUM_QUALITY_MET",
    "OPTIMIZATION_BUDGET_FEASIBLE",
    "NO_UNNECESSARY_ITEMS",
  ];
  if (
    !evidenceSupportsMaterialQualityClaim(evidence_status) &&
    rawRank > toQualityRank("ACCEPTABLE")
  ) {
    reasons.push("WEAK_EVIDENCE_NOT_TREATED_AS_PREMIUM");
  }
  if (voucherBenefit > 0 || loyaltyBenefit > 0) {
    reasons.push("INCENTIVE_USE_NOW_APPLIED");
  }
  if (
    voucherDecision === "SAVE_FOR_LATER" ||
    loyaltyDecision === "SAVE_FOR_LATER"
  ) {
    reasons.push("INCENTIVE_PRESERVED");
  }

  const basket = parseOrThrow(bestQualityBasketSchema, {
    basket_type: "BEST_QUALITY",
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
      objective: "BEST_QUALITY",
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
    ranking_quality_rank: rankingRank,
    raw_quality_rank: rawRank,
    confidence,
    evidence_status,
  };
}

/**
 * Doc 05 §12 Best Quality ranking (lexicographic):
 * 1. higher quality/reliability (Step 3 ranking rank; unsupported evidence excluded)
 * 2. lower uncertainty (higher confidence)
 * 3. lower practical_cost among materially similar quality (same ranking rank)
 * 4. lower excess
 * 5. higher incentive usefulness
 * 6. combination_key ascending
 */
export function compareBestQualityBaskets(
  a: EvaluatedBasket,
  b: EvaluatedBasket,
): number {
  if (a.ranking_quality_rank !== b.ranking_quality_rank) {
    return b.ranking_quality_rank - a.ranking_quality_rank;
  }

  if (a.confidence !== b.confidence) {
    return a.confidence > b.confidence ? -1 : 1;
  }

  // Materially similar quality → prefer lower practical cost (Doc 05 §12 / §11.2).
  if (a.basket.practical_cost_minor !== b.basket.practical_cost_minor) {
    return a.basket.practical_cost_minor - b.basket.practical_cost_minor;
  }

  if (a.basket.excess_quantity_total !== b.basket.excess_quantity_total) {
    return a.basket.excess_quantity_total - b.basket.excess_quantity_total;
  }

  if (a.incentive_usefulness_minor !== b.incentive_usefulness_minor) {
    return b.incentive_usefulness_minor - a.incentive_usefulness_minor;
  }

  return a.basket.combination_key.localeCompare(b.basket.combination_key);
}

/**
 * Generate the deterministic BEST_QUALITY basket for the given requirements.
 */
export function generateBestQualityBasket(
  input: BestQualityInput,
): BestQualityResult {
  assertMoneyMinor(input.budget_minor, "budget_minor");

  if (input.requirements.length === 0) {
    return parseOrThrow(bestQualityResultSchema, {
      feasible: false,
      rejection_reasons: ["REQUIREMENT_NOT_FULFILLED"],
      requirement_failures: [],
      explored_count: 0,
      bounds: { ...BEST_QUALITY_BOUNDS },
    });
  }

  if (input.requirements.length > BEST_QUALITY_BOUNDS.MAX_REQUIREMENTS) {
    return parseOrThrow(bestQualityResultSchema, {
      feasible: false,
      rejection_reasons: ["MISSING_AUTHORITATIVE_DATA"],
      requirement_failures: [],
      explored_count: 0,
      bounds: { ...BEST_QUALITY_BOUNDS },
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
    return parseOrThrow(bestQualityResultSchema, {
      feasible: false,
      rejection_reasons:
        reasons.length > 0 ? reasons : ["REQUIREMENT_NOT_FULFILLED"],
      requirement_failures: requirementFailures,
      explored_count: 0,
      bounds: { ...BEST_QUALITY_BOUNDS },
    });
  }

  const products = cartesianProduct(stage1Slots);
  const evaluated: EvaluatedBasket[] = [];
  let explored = 0;

  for (const combo of products) {
    if (explored >= BEST_QUALITY_BOUNDS.MAX_COMPLETE_BASKETS_EXPLORED) {
      break;
    }
    explored += 1;
    const result = evaluateCompleteBasket(combo, input);
    if (result) {
      evaluated.push(result);
    }
  }

  if (evaluated.length === 0) {
    return parseOrThrow(bestQualityResultSchema, {
      feasible: false,
      rejection_reasons: ["BUDGET_EXCEEDED"],
      requirement_failures: [],
      explored_count: explored,
      bounds: { ...BEST_QUALITY_BOUNDS },
    });
  }

  evaluated.sort(compareBestQualityBaskets);

  // Annotate material vs immaterial relative to next-best when useful.
  const winner = evaluated[0]!;
  if (evaluated.length > 1) {
    const runnerUp = evaluated[1]!;
    const reasons = [...winner.basket.explanation.reasons];
    if (
      hasMaterialQualityImprovement(winner, runnerUp) &&
      !reasons.includes("MATERIAL_QUALITY_IMPROVEMENT")
    ) {
      reasons.push("MATERIAL_QUALITY_IMPROVEMENT");
    } else if (
      winner.ranking_quality_rank === runnerUp.ranking_quality_rank &&
      winner.basket.practical_cost_minor <=
        runnerUp.basket.practical_cost_minor &&
      !reasons.includes("IMMATERIAL_QUALITY_COST_PREFERRED")
    ) {
      reasons.push("IMMATERIAL_QUALITY_COST_PREFERRED");
    }
    winner.basket = parseOrThrow(bestQualityBasketSchema, {
      ...winner.basket,
      explanation: {
        ...winner.basket.explanation,
        reasons,
      },
    });
  }

  return parseOrThrow(bestQualityResultSchema, {
    feasible: true,
    basket: winner.basket,
    alternatives_considered: Math.min(
      evaluated.length,
      BEST_QUALITY_BOUNDS.MAX_COMPLETE_BASKETS_RETURNED,
    ),
    bounds: { ...BEST_QUALITY_BOUNDS },
  });
}
