import { assertMoneyMinor, type MoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { calculateLineAmountMinor } from "../cart/pricing.js";
import {
  meetsMinimumQuality,
  parseMinimumQualityLabel,
  qualitySignalRank,
} from "../research/assessment-schema.js";
import type { QualitySignal } from "../research/schema.js";
import {
  evaluateCandidateFeasibility,
  parseOptimizationConstraints,
} from "./feasibility.js";
import {
  candidateMatchesRequirementItem,
  evaluateUnitCompatibility,
} from "./fulfillment.js";
import { compareBestValueCombinations } from "./quality-ranking.js";
import {
  PACK_OPT_BOUNDS,
  normalizeOptimizationRequirement,
  optimizationCandidateSchema,
  packCandidateInputSchema,
  packCombinationSchema,
  packQualitySnapshotSchema,
  type FulfillmentAssumption,
  type OptimizationCandidate,
  type OptimizationRejectionReason,
  type OptimizationRequirement,
  type OptimizationRequirementInput,
  type PackCandidateInput,
  type PackCombination,
  type PackCombinationLine,
  type PackOptimizationContextInput,
  type PackQualitySnapshot,
} from "./schema.js";

/**
 * Phase 5 Step 2 — Quantity + Pack Optimization (Doc 05 §7 / FR-05).
 *
 * Generates bounded pack combinations that cover a requirement, validates hard
 * constraints via Step 1 feasibility, propagates research quality snapshots,
 * and ranks feasible combinations deterministically.
 *
 * Does NOT compute final payable, vouchers, loyalty, or baskets.
 *
 * Cost model: unit_price_minor is the price of ONE pack (e.g. ₹12 for a 2-egg
 * pack). Combination gross = sum(pack_count × unit_price_minor). Never treat
 * pack price as a per-egg price.
 */

export type EligiblePack = {
  candidate: OptimizationCandidate;
  quality: PackQualitySnapshot;
  /** Units contributed toward the requirement by purchasing one pack. */
  units_per_pack: number;
  assumptions: FulfillmentAssumption[];
};

export type IneligiblePack = {
  candidate: OptimizationCandidate | null;
  rejection_reasons: OptimizationRejectionReason[];
};

export type PackOptimizationResult = {
  ranked: PackCombination[];
  rejected_combinations: PackCombination[];
  ineligible: IneligiblePack[];
  bounds: typeof PACK_OPT_BOUNDS;
  explored_count: number;
};

type InternalLineDraft = {
  pack: EligiblePack;
  pack_count: number;
};

function combinationKey(lines: readonly PackCombinationLine[]): string {
  return lines
    .map((line) => `${line.sku_id}:${line.pack_count}`)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

/**
 * Build an eligible pack from catalog + quality, or return rejection reasons.
 * Reuses Step 1 item/unit/feasibility rules — does not invent conversions.
 */
export function evaluateEligiblePack(
  requirement: OptimizationRequirement,
  input: PackCandidateInput,
  context: PackOptimizationContextInput = {},
):
  | { ok: true; pack: EligiblePack }
  | {
      ok: false;
      reasons: OptimizationRejectionReason[];
      candidate: OptimizationCandidate;
    } {
  const parsed = parseOrThrow(packCandidateInputSchema, input);
  const candidate = parsed.candidate;
  const quality = parsed.quality;

  const unitCompat = evaluateUnitCompatibility(requirement, candidate);
  if (!unitCompat.compatible || unitCompat.units_per_sku === null) {
    return {
      ok: false,
      reasons: ["REQUIREMENT_NOT_FULFILLED"],
      candidate,
    };
  }

  if (
    !Number.isFinite(candidate.pack_quantity) ||
    candidate.pack_quantity <= 0
  ) {
    return {
      ok: false,
      reasons: ["MISSING_AUTHORITATIVE_DATA"],
      candidate,
    };
  }

  // Step 1 feasibility first so exclusions surface as EXPLICITLY_EXCLUDED
  // (not REQUIREMENT_NOT_FULFILLED from item matching).
  const baseFeasibility = evaluateCandidateFeasibility(candidate, {
    ...context,
    requirement: {
      item_name: requirement.item_name,
      target_quantity: requirement.target_quantity,
      unit: requirement.unit,
      minimum_quality: requirement.minimum_quality,
      constraints_json: requirement.constraints_json,
    },
    proposed_quantity: 1,
  });

  if (!baseFeasibility.feasible) {
    return {
      ok: false,
      reasons: baseFeasibility.rejection_reasons,
      candidate,
    };
  }

  // Item/brand/category compatibility — exclusions already handled above.
  const constraintsWithoutExclusion = parseOptimizationConstraints(
    requirement.constraints_json,
  ).filter((entry) => entry.type !== "exclusion");
  if (
    !candidateMatchesRequirementItem(candidate, {
      ...requirement,
      constraints_json: constraintsWithoutExclusion,
    })
  ) {
    return {
      ok: false,
      reasons: ["REQUIREMENT_NOT_FULFILLED"],
      candidate,
    };
  }

  // Quality hard constraint when minimum is material (Doc 05 §4 / §7.3).
  if (requirement.minimum_quality !== null) {
    const minimum = parseMinimumQualityLabel(requirement.minimum_quality);
    if (minimum !== null) {
      const meets =
        quality.meets_minimum_quality !== null
          ? quality.meets_minimum_quality
          : meetsMinimumQuality(quality.quality_signal, minimum);
      if (!meets) {
        return {
          ok: false,
          reasons: ["REQUIREMENT_NOT_FULFILLED"],
          candidate,
        };
      }
    }
  }

  return {
    ok: true,
    pack: {
      candidate,
      quality,
      units_per_pack: unitCompat.units_per_sku,
      assumptions: unitCompat.assumptions,
    },
  };
}

function buildCombinationFromDrafts(
  requirement: OptimizationRequirement,
  drafts: readonly InternalLineDraft[],
  context: PackOptimizationContextInput,
): PackCombination {
  const lines: PackCombinationLine[] = [];
  const assumptions: FulfillmentAssumption[] = [];
  const assumptionCodes = new Set<string>();
  const reasons: OptimizationRejectionReason[] = [];

  let covered = 0;
  let gross = 0n;
  let packCountTotal = 0;
  const evidenceRefs = new Set<string>();
  const signals: Array<QualitySignal | null> = [];
  let minConfidence = 1;

  const sortedDrafts = drafts.slice().sort((a, b) =>
    a.pack.candidate.sku_id.localeCompare(b.pack.candidate.sku_id),
  );

  for (const draft of sortedDrafts) {
    const { pack, pack_count } = draft;
    const candidate = pack.candidate;

    if (!Number.isInteger(pack_count) || pack_count <= 0) {
      reasons.push("INVALID_QUANTITY");
      continue;
    }

    const feasibility = evaluateCandidateFeasibility(candidate, {
      ...context,
      requirement: {
        item_name: requirement.item_name,
        target_quantity: requirement.target_quantity,
        unit: requirement.unit,
        minimum_quality: requirement.minimum_quality,
        constraints_json: requirement.constraints_json,
      },
      proposed_quantity: pack_count,
      // Budget checked on combination gross — multi-SKU totals matter.
      budget_minor: undefined,
      // max_per_item checked below on line amount for clarity.
      max_per_item_minor: undefined,
    });

    if (!feasibility.feasible) {
      reasons.push(...feasibility.rejection_reasons);
    }

    let lineAmount: MoneyMinor;
    try {
      lineAmount = calculateLineAmountMinor(pack_count, candidate.price_minor);
    } catch {
      reasons.push("INVALID_QUANTITY");
      lineAmount = 0;
    }

    if (
      context.max_per_item_minor !== undefined &&
      context.max_per_item_minor !== null &&
      lineAmount > context.max_per_item_minor
    ) {
      reasons.push("MAX_PER_ITEM_EXCEEDED");
    }

    const unitsContributed = pack.units_per_pack * pack_count;
    covered += unitsContributed;
    gross += BigInt(lineAmount);
    packCountTotal += pack_count;

    signals.push(pack.quality.quality_signal);
    minConfidence = Math.min(minConfidence, pack.quality.confidence);
    for (const ref of pack.quality.evidence_refs) {
      evidenceRefs.add(ref);
    }
    for (const assumption of pack.assumptions) {
      if (!assumptionCodes.has(assumption.code)) {
        assumptionCodes.add(assumption.code);
        assumptions.push(assumption);
      }
    }

    lines.push({
      sku_id: candidate.sku_id,
      product_id: candidate.product_id,
      sku_code: candidate.sku_code,
      units_per_pack: pack.units_per_pack,
      pack_count,
      pack_quantity: candidate.pack_quantity,
      pack_unit: candidate.pack_unit,
      unit_price_minor: assertMoneyMinor(
        candidate.price_minor,
        "unit_price_minor",
      ),
      line_amount_minor: lineAmount,
      quality_signal: pack.quality.quality_signal,
      confidence: pack.quality.confidence,
      evidence_refs: [...pack.quality.evidence_refs].sort((a, b) =>
        a.localeCompare(b),
      ),
    });
  }

  if (covered < requirement.target_quantity) {
    reasons.push("REQUIREMENT_NOT_FULFILLED");
  }

  if (gross > BigInt(Number.MAX_SAFE_INTEGER)) {
    reasons.push("MISSING_AUTHORITATIVE_DATA");
  }

  let grossAmount = 0;
  try {
    grossAmount = assertMoneyMinor(Number(gross), "gross_amount_minor");
  } catch {
    reasons.push("MISSING_AUTHORITATIVE_DATA");
    grossAmount = 0;
  }

  if (
    context.budget_minor !== undefined &&
    grossAmount > context.budget_minor
  ) {
    reasons.push("BUDGET_EXCEEDED");
  }

  let comboSignal: QualitySignal | null = null;
  if (signals.length > 0 && signals.every((s) => s !== null)) {
    comboSignal = signals[0] as QualitySignal;
    for (const signal of signals) {
      if (
        signal !== null &&
        qualitySignalRank(signal) < qualitySignalRank(comboSignal)
      ) {
        comboSignal = signal;
      }
    }
  }

  if (requirement.minimum_quality !== null) {
    const minimum = parseMinimumQualityLabel(requirement.minimum_quality);
    if (minimum !== null && !meetsMinimumQuality(comboSignal, minimum)) {
      reasons.push("REQUIREMENT_NOT_FULFILLED");
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const excess = Math.max(0, covered - requirement.target_quantity);

  return parseOrThrow(packCombinationSchema, {
    combination_key: combinationKey(lines),
    lines,
    target_quantity: requirement.target_quantity,
    covered_quantity: covered,
    excess_quantity: excess,
    pack_count_total: packCountTotal,
    gross_amount_minor: grossAmount,
    currency: "INR",
    quality_signal: comboSignal,
    confidence: lines.length > 0 ? minConfidence : 0,
    evidence_refs: [...evidenceRefs].sort((a, b) => a.localeCompare(b)),
    assumptions,
    feasible: uniqueReasons.length === 0 && lines.length > 0,
    rejection_reasons: uniqueReasons,
  });
}

/**
 * Deterministic ranking among FEASIBLE combinations.
 * Delegates to Phase 5 Step 3 Best Value lexicographic order (Doc 05 §12).
 */
export function comparePackCombinations(
  a: PackCombination,
  b: PackCombination,
): number {
  return compareBestValueCombinations(a, b);
}

function maxCountForPack(
  pack: EligiblePack,
  targetQuantity: number,
): number {
  const stock =
    pack.candidate.stock_available === null
      ? 0
      : Math.floor(pack.candidate.stock_available);
  const minForCoverage = Math.max(
    1,
    Math.ceil(targetQuantity / pack.units_per_pack - Number.EPSILON),
  );
  const upper = Math.min(
    stock,
    PACK_OPT_BOUNDS.MAX_PACKS_PER_SKU,
    PACK_OPT_BOUNDS.MAX_TOTAL_PACKS,
    minForCoverage + PACK_OPT_BOUNDS.MAX_EXTRA_PACKS_BEYOND_MIN,
  );
  return Math.max(0, upper);
}

function enumerateCombinations(
  packs: readonly EligiblePack[],
  requirement: OptimizationRequirement,
  context: PackOptimizationContextInput,
): {
  feasible: PackCombination[];
  rejected: PackCombination[];
  explored: number;
} {
  const feasible: PackCombination[] = [];
  const rejected: PackCombination[] = [];
  const seenKeys = new Set<string>();
  let explored = 0;

  const record = (drafts: InternalLineDraft[]): void => {
    if (drafts.length === 0) {
      return;
    }
    if (explored >= PACK_OPT_BOUNDS.MAX_COMBINATIONS_EXPLORED) {
      return;
    }
    explored += 1;

    const combo = buildCombinationFromDrafts(requirement, drafts, context);
    if (seenKeys.has(combo.combination_key)) {
      return;
    }
    seenKeys.add(combo.combination_key);

    if (combo.feasible) {
      feasible.push(combo);
    } else {
      rejected.push(combo);
    }
  };

  const dfs = (
    index: number,
    drafts: InternalLineDraft[],
    covered: number,
    totalPacks: number,
    distinctCount: number,
  ): void => {
    if (explored >= PACK_OPT_BOUNDS.MAX_COMBINATIONS_EXPLORED) {
      return;
    }

    if (covered >= requirement.target_quantity && drafts.length > 0) {
      record(drafts);
    }

    if (index >= packs.length) {
      return;
    }
    if (totalPacks >= PACK_OPT_BOUNDS.MAX_TOTAL_PACKS) {
      return;
    }

    // Skip this SKU.
    dfs(index + 1, drafts, covered, totalPacks, distinctCount);

    if (explored >= PACK_OPT_BOUNDS.MAX_COMBINATIONS_EXPLORED) {
      return;
    }

    if (distinctCount >= PACK_OPT_BOUNDS.MAX_DISTINCT_SKUS_PER_COMBO) {
      return;
    }

    const pack = packs[index]!;
    const maxCount = maxCountForPack(pack, requirement.target_quantity);
    const remainingSlots = PACK_OPT_BOUNDS.MAX_TOTAL_PACKS - totalPacks;

    for (let count = 1; count <= maxCount && count <= remainingSlots; count++) {
      if (explored >= PACK_OPT_BOUNDS.MAX_COMBINATIONS_EXPLORED) {
        return;
      }

      const nextCovered = covered + pack.units_per_pack * count;
      const nextDrafts = [...drafts, { pack, pack_count: count }];
      dfs(
        index + 1,
        nextDrafts,
        nextCovered,
        totalPacks + count,
        distinctCount + 1,
      );
    }
  };

  dfs(0, [], 0, 0, 0);

  // Deterministic single-SKU safety net within the same bounds.
  for (const pack of packs) {
    if (explored >= PACK_OPT_BOUNDS.MAX_COMBINATIONS_EXPLORED) {
      break;
    }
    const maxCount = maxCountForPack(pack, requirement.target_quantity);
    const minCount = Math.max(
      1,
      Math.ceil(
        requirement.target_quantity / pack.units_per_pack - Number.EPSILON,
      ),
    );
    for (let count = minCount; count <= maxCount; count++) {
      if (explored >= PACK_OPT_BOUNDS.MAX_COMBINATIONS_EXPLORED) {
        break;
      }
      record([{ pack, pack_count: count }]);
    }
  }

  return { feasible, rejected, explored };
}

/**
 * Soft-parse a pack input so invalid pack_quantity / price become ineligible
 * rejections rather than thrown schema errors at the optimize boundary.
 */
function tryParsePackInput(input: unknown):
  | { ok: true; value: PackCandidateInput }
  | { ok: false; reasons: OptimizationRejectionReason[]; candidate: OptimizationCandidate | null } {
  const result = packCandidateInputSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }

  // Inspect raw candidate for more specific reasons when possible.
  const raw =
    input && typeof input === "object" && "candidate" in input
      ? (input as { candidate: unknown }).candidate
      : null;

  if (raw && typeof raw === "object") {
    const c = raw as Record<string, unknown>;
    const packQty = c.pack_quantity;
    if (
      packQty === null ||
      packQty === undefined ||
      (typeof packQty === "number" &&
        (!Number.isFinite(packQty) || packQty <= 0))
    ) {
      const candidateParse = optimizationCandidateSchema.safeParse({
        ...c,
        pack_quantity: 1,
      });
      return {
        ok: false,
        reasons:
          typeof packQty === "number" && packQty <= 0
            ? ["INVALID_QUANTITY"]
            : ["MISSING_AUTHORITATIVE_DATA"],
        candidate: candidateParse.success ? candidateParse.data : null,
      };
    }
  }

  return {
    ok: false,
    reasons: ["MISSING_AUTHORITATIVE_DATA"],
    candidate: null,
  };
}

/**
 * Optimize pack combinations for one requirement over a reduced candidate set.
 */
export function optimizePackCombinations(
  requirementInput: OptimizationRequirementInput,
  packInputs: readonly unknown[],
  context: PackOptimizationContextInput = {},
): PackOptimizationResult {
  const requirement = normalizeOptimizationRequirement(requirementInput);

  const eligible: EligiblePack[] = [];
  const ineligible: IneligiblePack[] = [];

  const parsedInputs: PackCandidateInput[] = [];
  for (const input of packInputs) {
    const parsed = tryParsePackInput(input);
    if (!parsed.ok) {
      ineligible.push({
        candidate: parsed.candidate,
        rejection_reasons: parsed.reasons,
      });
      continue;
    }
    parsedInputs.push(parsed.value);
  }

  parsedInputs.sort((a, b) => {
    const bySku = a.candidate.sku_id.localeCompare(b.candidate.sku_id);
    if (bySku !== 0) {
      return bySku;
    }
    return a.candidate.product_id.localeCompare(b.candidate.product_id);
  });

  for (const input of parsedInputs) {
    const result = evaluateEligiblePack(requirement, input, context);
    if (result.ok) {
      eligible.push(result.pack);
    } else {
      ineligible.push({
        candidate: result.candidate,
        rejection_reasons: result.reasons,
      });
    }
  }

  const boundedEligible = eligible.slice(0, PACK_OPT_BOUNDS.MAX_ELIGIBLE_SKUS);

  const { feasible, rejected, explored } = enumerateCombinations(
    boundedEligible,
    requirement,
    context,
  );

  const ranked = feasible
    .slice()
    .sort(comparePackCombinations)
    .slice(0, PACK_OPT_BOUNDS.MAX_COMBINATIONS_RETURNED);

  return {
    ranked,
    rejected_combinations: rejected,
    ineligible,
    bounds: PACK_OPT_BOUNDS,
    explored_count: explored,
  };
}

/**
 * Convenience: attach a quality snapshot to a catalog candidate.
 * Does not invent quality — caller supplies research assessment fields.
 */
export function toPackCandidateInput(
  candidate: OptimizationCandidate,
  quality: PackQualitySnapshot,
): PackCandidateInput {
  return parseOrThrow(packCandidateInputSchema, {
    candidate: parseOrThrow(optimizationCandidateSchema, candidate),
    quality: parseOrThrow(packQualitySnapshotSchema, quality),
  });
}
