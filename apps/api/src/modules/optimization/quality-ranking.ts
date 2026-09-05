import { assertMoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import {
  QUALITY_SIGNAL_RANK,
  meetsMinimumQuality,
  parseMinimumQualityLabel,
  qualitySignalRank,
  type EvidenceStatus,
} from "../research/assessment-schema.js";
import type { QualitySignal } from "../research/schema.js";
import {
  packCombinationSchema,
  qualityRankedCombinationSchema,
  qualityRankingObjectiveSchema,
  qualityRankingViewSchema,
  type OptimizationRejectionReason,
  type PackCombination,
  type PackQualitySnapshot,
  type QualityRankedCombination,
  type QualityRankingObjective,
  type QualityRankingView,
} from "./schema.js";

/**
 * Phase 5 Step 3 — Quality-aware deterministic ranking (Doc 05 §6 / §12).
 *
 * Consumes Phase 4 structured quality snapshots / Step 2 pack combinations.
 * Does not invent quality, call LLMs, or generate baskets.
 *
 * Locked quality order (Doc 05 §6.1 / Phase 4):
 * UNACCEPTABLE < ACCEPTABLE < GOOD < PREMIUM
 *
 * Ranking uses lexicographic order — not an opaque weighted scalar.
 */

export { QUALITY_SIGNAL_RANK };

function sortedSkuKey(combination: PackCombination): string {
  return combination.lines
    .map((line) => line.sku_id)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join(",");
}

/**
 * Map an authoritative quality signal to its deterministic ordinal.
 * null → -1 (never invent a positive rank).
 */
export function toQualityRank(signal: QualitySignal | null): number {
  if (signal === null) {
    return -1;
  }
  return qualitySignalRank(signal);
}

/**
 * Build a ranking view from structured Phase 4 / Step 2 fields only.
 * Ignores any free-text that might exist on unrelated objects.
 */
export function normalizeQualityRankingView(input: {
  quality_signal: QualitySignal | null;
  confidence: number;
  evidence_refs: readonly string[];
  evidence_status?: EvidenceStatus | null;
  meets_minimum_quality?: boolean | null;
  minimum_quality?: QualitySignal | null;
}): QualityRankingView {
  const signal = input.quality_signal;
  const minimum = input.minimum_quality ?? null;
  let meets = input.meets_minimum_quality ?? null;
  if (minimum !== null && meets === null) {
    meets = meetsMinimumQuality(signal, minimum);
  }

  return parseOrThrow(qualityRankingViewSchema, {
    quality_signal: signal,
    quality_rank: toQualityRank(signal),
    confidence: input.confidence,
    evidence_refs: [...input.evidence_refs].sort((a, b) => a.localeCompare(b)),
    evidence_status: input.evidence_status ?? null,
    meets_minimum_quality: meets,
  });
}

export function qualityViewFromPackCombination(
  combination: PackCombination,
  options: {
    minimum_quality?: QualitySignal | null;
    evidence_status?: EvidenceStatus | null;
  } = {},
): QualityRankingView {
  return normalizeQualityRankingView({
    quality_signal: combination.quality_signal,
    confidence: combination.confidence,
    evidence_refs: combination.evidence_refs,
    evidence_status: options.evidence_status ?? null,
    minimum_quality: options.minimum_quality ?? null,
  });
}

export function qualityViewFromSnapshot(
  snapshot: PackQualitySnapshot,
  minimumQuality: QualitySignal | null = null,
): QualityRankingView {
  return normalizeQualityRankingView({
    quality_signal: snapshot.quality_signal,
    confidence: snapshot.confidence,
    evidence_refs: snapshot.evidence_refs,
    evidence_status: snapshot.evidence_status,
    meets_minimum_quality: snapshot.meets_minimum_quality,
    minimum_quality: minimumQuality,
  });
}

/**
 * Hard minimum-quality gate (Doc 05 §4 / §7.3).
 * Fail closed when signal is missing and a minimum is material.
 */
export function evaluateHardMinimumQuality(
  qualitySignal: QualitySignal | null,
  minimumQualityLabel: string | null | undefined,
): {
  meets: boolean;
  minimum: QualitySignal | null;
  rejection_reasons: OptimizationRejectionReason[];
} {
  if (minimumQualityLabel === null || minimumQualityLabel === undefined) {
    return { meets: true, minimum: null, rejection_reasons: [] };
  }

  const minimum = parseMinimumQualityLabel(minimumQualityLabel);
  if (minimum === null) {
    return { meets: true, minimum: null, rejection_reasons: [] };
  }

  if (!meetsMinimumQuality(qualitySignal, minimum)) {
    return {
      meets: false,
      minimum,
      rejection_reasons: ["REQUIREMENT_NOT_FULFILLED"],
    };
  }

  return { meets: true, minimum, rejection_reasons: [] };
}

function assertIntegerGross(combination: PackCombination): void {
  assertMoneyMinor(combination.gross_amount_minor, "gross_amount_minor");
  for (const line of combination.lines) {
    assertMoneyMinor(line.unit_price_minor, "unit_price_minor");
    assertMoneyMinor(line.line_amount_minor, "line_amount_minor");
  }
}

/**
 * Doc 05 §12 Best Value lexicographic order (gross stands in for final payable
 * at pack-optimization stage — vouchers/discounts are deferred):
 * 1. lower gross_amount_minor
 * 2. higher quality_rank
 * 3. lower excess_quantity
 * 4. higher confidence (lower uncertainty)
 * 5. sorted sku_id key
 * 6. combination_key
 */
export function compareBestValueCombinations(
  a: PackCombination,
  b: PackCombination,
): number {
  assertIntegerGross(a);
  assertIntegerGross(b);

  if (a.gross_amount_minor !== b.gross_amount_minor) {
    return a.gross_amount_minor - b.gross_amount_minor;
  }

  const rankA = toQualityRank(a.quality_signal);
  const rankB = toQualityRank(b.quality_signal);
  if (rankA !== rankB) {
    return rankB - rankA;
  }

  if (a.excess_quantity !== b.excess_quantity) {
    return a.excess_quantity - b.excess_quantity;
  }

  if (a.confidence !== b.confidence) {
    return a.confidence > b.confidence ? -1 : 1;
  }

  const skuCmp = sortedSkuKey(a).localeCompare(sortedSkuKey(b));
  if (skuCmp !== 0) {
    return skuCmp;
  }

  return a.combination_key.localeCompare(b.combination_key);
}

/**
 * Doc 05 §12 Best Quality lexicographic order (basket selection deferred):
 * 1. higher quality_rank
 * 2. higher confidence (lower uncertainty)
 * 3. lower gross_amount_minor
 * 4. lower excess_quantity
 * 5. sorted sku_id key
 * 6. combination_key
 *
 * Still requires hard feasibility + minimum quality + budget before use.
 */
export function compareBestQualityCombinations(
  a: PackCombination,
  b: PackCombination,
): number {
  assertIntegerGross(a);
  assertIntegerGross(b);

  const rankA = toQualityRank(a.quality_signal);
  const rankB = toQualityRank(b.quality_signal);
  if (rankA !== rankB) {
    return rankB - rankA;
  }

  if (a.confidence !== b.confidence) {
    return a.confidence > b.confidence ? -1 : 1;
  }

  if (a.gross_amount_minor !== b.gross_amount_minor) {
    return a.gross_amount_minor - b.gross_amount_minor;
  }

  if (a.excess_quantity !== b.excess_quantity) {
    return a.excess_quantity - b.excess_quantity;
  }

  const skuCmp = sortedSkuKey(a).localeCompare(sortedSkuKey(b));
  if (skuCmp !== 0) {
    return skuCmp;
  }

  return a.combination_key.localeCompare(b.combination_key);
}

export function compareByObjective(
  a: PackCombination,
  b: PackCombination,
  objective: QualityRankingObjective,
): number {
  if (objective === "BEST_QUALITY") {
    return compareBestQualityCombinations(a, b);
  }
  return compareBestValueCombinations(a, b);
}

export type QualityAwareRankingInput = {
  /** Already-generated pack combinations (Step 2). */
  combinations: readonly PackCombination[];
  /** Ranking objective primitive for later basket layers. */
  objective?: QualityRankingObjective;
  /**
   * Hard minimum quality label (e.g. ACCEPTABLE).
   * Fail closed when signal cannot establish the threshold.
   */
  minimum_quality?: string | null;
  /**
   * Optional hard budget ceiling (paise). Over-budget combos are excluded,
   * never ranked as if quality could override the ceiling.
   */
  budget_minor?: number;
  /**
   * Optional evidence_status by combination_key when callers have richer
   * snapshots than PackCombination carries.
   */
  evidence_status_by_key?: ReadonlyMap<string, EvidenceStatus | null>;
};

export type QualityAwareRankingResult = {
  objective: QualityRankingObjective;
  ranked: QualityRankedCombination[];
  rejected: Array<{
    combination: PackCombination;
    rejection_reasons: OptimizationRejectionReason[];
  }>;
};

/**
 * Rank feasible pack combinations with quality awareness.
 * Hard constraints are filters — never soft objectives.
 */
export function rankQualityAwareCombinations(
  input: QualityAwareRankingInput,
): QualityAwareRankingResult {
  const objective = parseOrThrow(
    qualityRankingObjectiveSchema,
    input.objective ?? "BEST_VALUE",
  );

  const minimumLabel =
    input.minimum_quality === undefined ? null : input.minimum_quality;
  const minimumSignal =
    minimumLabel === null || minimumLabel === undefined
      ? null
      : parseMinimumQualityLabel(minimumLabel);

  const rankedCandidates: PackCombination[] = [];
  const rejected: QualityAwareRankingResult["rejected"] = [];

  for (const raw of input.combinations) {
    const combination = parseOrThrow(packCombinationSchema, raw);

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

    try {
      assertIntegerGross(combination);
    } catch {
      reasons.push("MISSING_AUTHORITATIVE_DATA");
    }

    if (
      input.budget_minor !== undefined &&
      combination.gross_amount_minor > input.budget_minor
    ) {
      reasons.push("BUDGET_EXCEEDED");
    }

    const hardQuality = evaluateHardMinimumQuality(
      combination.quality_signal,
      minimumLabel,
    );
    if (!hardQuality.meets) {
      reasons.push(...hardQuality.rejection_reasons);
    }

    const uniqueReasons = [...new Set(reasons)];
    if (uniqueReasons.length > 0) {
      rejected.push({
        combination,
        rejection_reasons: uniqueReasons,
      });
      continue;
    }

    rankedCandidates.push(combination);
  }

  const sorted = rankedCandidates.slice().sort((a, b) => {
    const cmp = compareByObjective(a, b, objective);
    if (cmp !== 0) {
      return cmp;
    }
    // Extra stability if comparator ties completely.
    return a.combination_key.localeCompare(b.combination_key);
  });

  const ranked: QualityRankedCombination[] = sorted.map((combination, index) => {
    const status =
      input.evidence_status_by_key?.get(combination.combination_key) ?? null;
    const quality = qualityViewFromPackCombination(combination, {
      minimum_quality: minimumSignal,
      evidence_status: status,
    });
    return parseOrThrow(qualityRankedCombinationSchema, {
      rank_index: index,
      objective,
      combination,
      quality,
    });
  });

  return { objective, ranked, rejected };
}
