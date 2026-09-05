import { parseOrThrow } from "../../shared/validation/index.js";
import {
  evaluateCandidateFeasibility,
  parseOptimizationConstraints,
} from "./feasibility.js";
import {
  fulfillmentOptionsSchema,
  fulfillmentResultSchema,
  normalizeOptimizationRequirement,
  optimizationCandidateSchema,
  type FeasibilityContextInput,
  type FulfillmentAssumption,
  type FulfillmentOptions,
  type FulfillmentResult,
  type OptimizationCandidate,
  type OptimizationRejectionReason,
  type OptimizationRequirement,
  type OptimizationRequirementInput,
} from "./schema.js";

/**
 * Deterministic requirement fulfillment evaluation (Phase 5 Step 1 / Doc 05 §4).
 *
 * Determines whether an authoritative candidate can contribute toward a
 * structured requirement (item, target quantity, unit, constraints).
 * Does not invent products, conversion factors, prices, or stock.
 */

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Item compatibility: product name must contain the requirement item_name.
 * Brand constraint (when present) must also match brand or product name.
 * Free-text summaries are never consulted.
 */
export function candidateMatchesRequirementItem(
  candidate: OptimizationCandidate,
  requirement: OptimizationRequirement,
): boolean {
  const item = normalizeToken(requirement.item_name);
  if (!item) {
    return false;
  }
  const name = normalizeToken(candidate.product_name);
  if (!name.includes(item)) {
    return false;
  }

  const constraints = parseOptimizationConstraints(requirement.constraints_json);
  for (const entry of constraints) {
    if (entry.type === "brand") {
      const brandNeedle = normalizeToken(entry.value);
      const brand = normalizeToken(candidate.brand ?? "");
      const inName = name.includes(brandNeedle);
      const inBrand = brand.length > 0 && brand.includes(brandNeedle);
      if (!inName && !inBrand) {
        return false;
      }
    }
    if (entry.type === "category") {
      if (
        normalizeToken(candidate.category_code) !== normalizeToken(entry.value)
      ) {
        return false;
      }
    }
    if (entry.type === "exclusion") {
      const needle = normalizeToken(entry.value);
      const haystacks = [
        candidate.product_name,
        candidate.sku_code,
        candidate.brand ?? "",
      ];
      if (
        haystacks.some((field) => {
          const hay = normalizeToken(field);
          return hay.length > 0 && (hay === needle || hay.includes(needle));
        })
      ) {
        return false;
      }
    }
  }

  return true;
}

export type UnitCompatibility = {
  compatible: boolean;
  /**
   * Quantity contributed by one purchased SKU toward the requirement unit.
   * null when units are incompatible (no invented conversion).
   */
  units_per_sku: number | null;
  assumptions: FulfillmentAssumption[];
};

/**
 * Unit compatibility without inventing conversion factors.
 *
 * - Exact unit match (normalized): covered uses pack_quantity per purchase.
 * - Requirement unit "packs": each purchased SKU counts as 1 pack
 *   (explicit MVP assumption PACKS_COUNT_AS_SKU_PURCHASES — Phase 3 pasta).
 * - Otherwise incompatible.
 */
export function evaluateUnitCompatibility(
  requirement: OptimizationRequirement,
  candidate: OptimizationCandidate,
): UnitCompatibility {
  const reqUnit = normalizeToken(requirement.unit);
  const packUnit = normalizeToken(candidate.pack_unit);
  const assumptions: FulfillmentAssumption[] = [];

  if (!reqUnit || !packUnit) {
    return { compatible: false, units_per_sku: null, assumptions };
  }

  if (reqUnit === packUnit) {
    if (
      !Number.isFinite(candidate.pack_quantity) ||
      candidate.pack_quantity <= 0
    ) {
      return { compatible: false, units_per_sku: null, assumptions };
    }
    return {
      compatible: true,
      units_per_sku: candidate.pack_quantity,
      assumptions,
    };
  }

  if (reqUnit === "packs") {
    assumptions.push({
      code: "PACKS_COUNT_AS_SKU_PURCHASES",
      message:
        'Requirement unit "packs" counts each purchased SKU as one pack; SKU pack_unit describes contents and is not converted.',
    });
    return { compatible: true, units_per_sku: 1, assumptions };
  }

  return { compatible: false, units_per_sku: null, assumptions };
}

function coveredQuantity(
  unitsPerSku: number,
  proposedQuantity: number,
): number {
  // Non-money quantity arithmetic — may be decimal (e.g. pack_quantity 0.5).
  return unitsPerSku * proposedQuantity;
}

function minimumPurchaseQuantity(
  targetQuantity: number,
  unitsPerSku: number,
): number {
  if (unitsPerSku <= 0 || !Number.isFinite(unitsPerSku)) {
    return 1;
  }
  const raw = Math.ceil(targetQuantity / unitsPerSku - Number.EPSILON);
  if (!Number.isFinite(raw) || raw < 1) {
    return 1;
  }
  return raw;
}

/**
 * Evaluate whether a candidate can contribute toward / fulfill a requirement.
 */
export function evaluateRequirementFulfillment(
  requirementInput: OptimizationRequirementInput,
  candidateInput: OptimizationCandidate,
  optionsInput: FulfillmentOptions = {},
): FulfillmentResult {
  const requirement = normalizeOptimizationRequirement(requirementInput);
  const candidate = parseOrThrow(optimizationCandidateSchema, candidateInput);
  const options = parseOrThrow(fulfillmentOptionsSchema, optionsInput);

  const reasons: OptimizationRejectionReason[] = [];
  const unitCompat = evaluateUnitCompatibility(requirement, candidate);
  const assumptions = unitCompat.assumptions.slice();

  if (!candidateMatchesRequirementItem(candidate, requirement)) {
    reasons.push("REQUIREMENT_NOT_FULFILLED");
  }

  if (!unitCompat.compatible || unitCompat.units_per_sku === null) {
    reasons.push("REQUIREMENT_NOT_FULFILLED");
  }

  let proposedQuantity: number;
  if (options.proposed_quantity !== undefined) {
    proposedQuantity = options.proposed_quantity;
  } else if (unitCompat.compatible && unitCompat.units_per_sku !== null) {
    proposedQuantity = minimumPurchaseQuantity(
      requirement.target_quantity,
      unitCompat.units_per_sku,
    );
  } else {
    proposedQuantity = 1;
  }

  let covered: number | null = null;
  if (
    unitCompat.compatible &&
    unitCompat.units_per_sku !== null &&
    reasons.length === 0
  ) {
    covered = coveredQuantity(unitCompat.units_per_sku, proposedQuantity);
  }

  const canContribute =
    reasons.length === 0 && covered !== null && covered > 0;
  const canFulfill =
    canContribute &&
    covered !== null &&
    covered >= requirement.target_quantity;

  if (!canFulfill && !reasons.includes("REQUIREMENT_NOT_FULFILLED")) {
    // Compatible contributor that still cannot meet target at evaluated qty.
    if (!canContribute || (covered !== null && covered < requirement.target_quantity)) {
      reasons.push("REQUIREMENT_NOT_FULFILLED");
    }
  }

  const uniqueReasons = [...new Set(reasons)];

  return parseOrThrow(fulfillmentResultSchema, {
    can_contribute: canContribute,
    can_fulfill: canFulfill,
    covered_quantity: covered,
    proposed_quantity: proposedQuantity,
    rejection_reasons: uniqueReasons,
    assumptions,
  });
}

/**
 * Joint check: candidate must be feasible under hard constraints AND able to
 * fulfill the requirement. Used by later steps as a pre-filter — not ranking.
 */
export function evaluateCandidateForRequirement(
  requirementInput: OptimizationRequirementInput,
  candidateInput: OptimizationCandidate,
  feasibilityContext: FeasibilityContextInput = {},
  fulfillmentOptions: FulfillmentOptions = {},
): {
  feasible: boolean;
  fulfillment: FulfillmentResult;
  feasibility: ReturnType<typeof evaluateCandidateFeasibility>;
} {
  const fulfillment = evaluateRequirementFulfillment(
    requirementInput,
    candidateInput,
    fulfillmentOptions,
  );

  const feasibility = evaluateCandidateFeasibility(candidateInput, {
    ...feasibilityContext,
    requirement: requirementInput,
    proposed_quantity:
      fulfillmentOptions.proposed_quantity ?? fulfillment.proposed_quantity,
  });

  return {
    feasible: feasibility.feasible && fulfillment.can_fulfill,
    fulfillment,
    feasibility,
  };
}
