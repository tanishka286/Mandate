import { assertMoneyMinor, type MoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { calculateLineAmountMinor } from "../cart/pricing.js";
import {
  feasibilityContextSchema,
  feasibilityResultSchema,
  optimizationCandidateSchema,
  optimizationConstraintEntrySchema,
  type FeasibilityContextInput,
  type FeasibilityResult,
  type OptimizationCandidate,
  type OptimizationConstraintEntry,
  type OptimizationRejectionReason,
  type OptimizationRequirement,
} from "./schema.js";

/**
 * Deterministic candidate feasibility filtering (Phase 5 Step 1 / Doc 05 §5.1).
 *
 * The AI is an untrusted proposer. This layer filters using authoritative
 * catalog/stock/mandate constraint inputs only. It does not authorize payment —
 * the policy engine remains the final authorization authority.
 *
 * Hard constraints are never traded away for a better score.
 */

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Parse known constraint entries from requirement.constraints_json.
 * Unknown shapes are ignored (never treated as authority).
 */
export function parseOptimizationConstraints(
  constraintsJson: readonly unknown[] | undefined,
): OptimizationConstraintEntry[] {
  if (!constraintsJson || constraintsJson.length === 0) {
    return [];
  }
  const parsed: OptimizationConstraintEntry[] = [];
  for (const entry of constraintsJson) {
    const result = optimizationConstraintEntrySchema.safeParse(entry);
    if (result.success) {
      parsed.push(result.data);
    }
  }
  return parsed;
}

function matchesExclusion(
  candidate: OptimizationCandidate,
  exclusionValue: string,
): boolean {
  const needle = normalizeToken(exclusionValue);
  if (!needle) {
    return false;
  }
  const haystacks = [
    candidate.product_name,
    candidate.sku_code,
    candidate.brand ?? "",
    candidate.category_code,
  ];
  return haystacks.some((field) => {
    const hay = normalizeToken(field);
    return hay.length > 0 && (hay === needle || hay.includes(needle));
  });
}

/**
 * Evaluate whether one authoritative candidate is feasible under hard constraints.
 * Same inputs always produce the same result (no randomness / timestamps / LLM).
 */
export function evaluateCandidateFeasibility(
  candidateInput: OptimizationCandidate,
  contextInput: FeasibilityContextInput = {},
): FeasibilityResult {
  const candidate = parseOrThrow(optimizationCandidateSchema, candidateInput);
  const context = parseOrThrow(feasibilityContextSchema, contextInput);

  const reasons: OptimizationRejectionReason[] = [];
  let lineAmountMinor: MoneyMinor | null = null;

  const proposedQuantity = context.proposed_quantity ?? 1;
  const quantityOk = isValidPurchaseQuantity(proposedQuantity);
  if (!quantityOk) {
    reasons.push("INVALID_QUANTITY");
  }

  // --- Lifecycle ---
  if (candidate.product_status !== "ACTIVE") {
    reasons.push("INACTIVE_PRODUCT");
  }
  if (candidate.sku_status !== "ACTIVE") {
    reasons.push("INACTIVE_SKU");
  }

  // --- Authoritative money / pack facts (never fabricate) ---
  let priceOk = false;
  try {
    assertMoneyMinor(candidate.price_minor, "price_minor");
    if (candidate.currency !== "INR") {
      reasons.push("MISSING_AUTHORITATIVE_DATA");
    } else {
      priceOk = true;
    }
  } catch {
    reasons.push("MISSING_AUTHORITATIVE_DATA");
  }

  if (
    !Number.isFinite(candidate.pack_quantity) ||
    candidate.pack_quantity <= 0
  ) {
    reasons.push("MISSING_AUTHORITATIVE_DATA");
  }

  // --- Stock (null row = insufficient data → not available) ---
  if (
    candidate.stock_available === null ||
    candidate.stock_available === undefined
  ) {
    reasons.push("OUT_OF_STOCK");
  } else if (
    quantityOk &&
    candidate.stock_available < proposedQuantity
  ) {
    // Includes 0 and any amount below the proposed purchase quantity.
    reasons.push("OUT_OF_STOCK");
  } else if (!quantityOk && candidate.stock_available <= 0) {
    reasons.push("OUT_OF_STOCK");
  }

  // --- Mandate / requirement category allow-list ---
  const allowed = context.allowed_categories;
  if (allowed && allowed.length > 0) {
    const allowedSet = new Set(allowed.map(normalizeToken));
    if (!allowedSet.has(normalizeToken(candidate.category_code))) {
      reasons.push("CATEGORY_NOT_ALLOWED");
    }
  }

  const requirementConstraints = context.requirement
    ? parseOptimizationConstraints(context.requirement.constraints_json)
    : [];

  for (const entry of requirementConstraints) {
    if (entry.type === "category") {
      if (normalizeToken(candidate.category_code) !== normalizeToken(entry.value)) {
        reasons.push("CATEGORY_NOT_ALLOWED");
      }
    }
    if (entry.type === "exclusion" && matchesExclusion(candidate, entry.value)) {
      reasons.push("EXPLICITLY_EXCLUDED");
    }
  }

  // --- Line money vs hard ceilings (integer paise only) ---
  if (priceOk && quantityOk) {
    try {
      lineAmountMinor = calculateLineAmountMinor(
        proposedQuantity,
        candidate.price_minor,
      );
    } catch {
      reasons.push("INVALID_QUANTITY");
      lineAmountMinor = null;
    }
  }

  if (
    context.budget_minor !== undefined &&
    lineAmountMinor !== null &&
    lineAmountMinor > context.budget_minor
  ) {
    reasons.push("BUDGET_EXCEEDED");
  }

  if (
    context.max_per_item_minor !== undefined &&
    context.max_per_item_minor !== null &&
    lineAmountMinor !== null &&
    lineAmountMinor > context.max_per_item_minor
  ) {
    reasons.push("MAX_PER_ITEM_EXCEEDED");
  }

  // Deduplicate while preserving deterministic check order.
  const uniqueReasons = [...new Set(reasons)];

  return parseOrThrow(feasibilityResultSchema, {
    feasible: uniqueReasons.length === 0,
    rejection_reasons: uniqueReasons,
    line_amount_minor: lineAmountMinor,
  });
}

export type FilteredCandidates = {
  feasible: OptimizationCandidate[];
  rejected: Array<{
    candidate: OptimizationCandidate;
    result: FeasibilityResult;
  }>;
};

/**
 * Filter candidates deterministically (stable sku_id / product_id ordering).
 */
export function filterFeasibleCandidates(
  candidates: readonly OptimizationCandidate[],
  contextInput: FeasibilityContextInput = {},
): FilteredCandidates {
  const context = parseOrThrow(feasibilityContextSchema, contextInput);

  const sorted = candidates
    .map((c) => parseOrThrow(optimizationCandidateSchema, c))
    .slice()
    .sort((a, b) => {
      const bySku = a.sku_id.localeCompare(b.sku_id);
      if (bySku !== 0) {
        return bySku;
      }
      return a.product_id.localeCompare(b.product_id);
    });

  const feasible: OptimizationCandidate[] = [];
  const rejected: FilteredCandidates["rejected"] = [];

  for (const candidate of sorted) {
    const result = evaluateCandidateFeasibility(candidate, context);
    if (result.feasible) {
      feasible.push(candidate);
    } else {
      rejected.push({ candidate, result });
    }
  }

  return { feasible, rejected };
}

/**
 * Validate proposed purchase quantity for optimization inputs.
 * Non-positive / non-integer quantities are never treated as purchasable.
 */
export function isValidPurchaseQuantity(quantity: unknown): boolean {
  return (
    typeof quantity === "number" &&
    Number.isInteger(quantity) &&
    quantity > 0
  );
}

export function evaluateProposedQuantityOrReject(
  quantity: unknown,
): { ok: true; quantity: number } | { ok: false; reason: "INVALID_QUANTITY" } {
  if (!isValidPurchaseQuantity(quantity)) {
    return { ok: false, reason: "INVALID_QUANTITY" };
  }
  return { ok: true, quantity: quantity as number };
}

/** Re-export for callers that need requirement typing beside feasibility. */
export type { OptimizationRequirement };
