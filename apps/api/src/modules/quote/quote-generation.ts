import { createHash } from "node:crypto";
import { calculateLineAmountMinor } from "../cart/pricing.js";
import { assertMoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import {
  QUOTE_AMOUNT_KIND,
  QUOTE_CURRENCY,
  quoteCalculationInputSchema,
  quoteResultSchema,
  type QuoteAppliedIncentive,
  type QuoteCalculationInputRaw,
  type QuoteFailureReason,
  type QuoteIncentiveInput,
  type QuoteLineResult,
  type QuoteResult,
} from "./schema.js";

/**
 * Phase 5 Step 10 — Deterministic Quote Generation (Doc 08 §13 / Doc 05 §15).
 *
 * Recalculates authoritative gross / discount / final_payable from:
 * - current backend unit prices
 * - current stock availability
 * - authoritative valid USE_NOW incentive benefits
 *
 * Does NOT:
 * - trust practical_cost_minor / client totals
 * - re-optimize baskets
 * - emit Policy ALLOW/DENY
 * - create payment / Razorpay / selection / HTTP
 */

function fail(
  reason_code: QuoteFailureReason,
  message: string,
  basket_id: string | null,
): QuoteResult {
  return parseOrThrow(quoteResultSchema, {
    ok: false,
    reason_code,
    message,
    basket_id,
    policy_decision: null,
    payment_created: false,
    selection_created: false,
  });
}

/**
 * Whether an incentive contributes a current quote discount.
 * SAVE_FOR_LATER / DO_NOT_USE / EXPIRED / INELIGIBLE / INVALID → not applied.
 */
export function isApplicableCurrentIncentive(
  incentive: QuoteIncentiveInput,
): boolean {
  return (
    incentive.decision === "USE_NOW" &&
    incentive.validity === "VALID" &&
    incentive.eligibility === "ELIGIBLE" &&
    incentive.benefit_minor > 0
  );
}

/**
 * Content-addressed quote_version for authorization tracing (Doc 08 §13.2).
 * Deterministic for identical authoritative calculation outputs — no timestamps.
 */
export function deriveQuoteVersion(args: {
  basket_id: string;
  currency: string;
  lines: readonly QuoteLineResult[];
  gross_amount_minor: number;
  discount_amount_minor: number;
  final_payable_minor: number;
  applied_incentives: readonly QuoteAppliedIncentive[];
}): string {
  const linePart = args.lines
    .map(
      (line) =>
        `${line.sku_id}:${line.quantity}:${line.unit_price_minor}:${line.line_amount_minor}`,
    )
    .sort((a, b) => a.localeCompare(b))
    .join(",");
  const incentivePart = args.applied_incentives
    .map((i) => `${i.kind}:${i.incentive_id}:${i.benefit_minor}`)
    .sort((a, b) => a.localeCompare(b))
    .join(",");
  const payload = [
    args.basket_id,
    args.currency,
    linePart,
    String(args.gross_amount_minor),
    String(args.discount_amount_minor),
    String(args.final_payable_minor),
    incentivePart,
  ].join("|");
  const digest = createHash("sha256").update(payload, "utf8").digest("hex");
  return `quote-${digest.slice(0, 16)}`;
}

/**
 * Resolve current discounts from authoritative incentive evaluations.
 * Each incentive_id / benefit_identity applied at most once.
 * Stale/invalid/SAVE_FOR_LATER/DO_NOT_USE contributions are omitted (not invented).
 */
export function resolveApplicableIncentiveBenefits(
  incentives: readonly QuoteIncentiveInput[],
): {
  discount_amount_minor: number;
  applied: QuoteAppliedIncentive[];
} {
  const applied: QuoteAppliedIncentive[] = [];
  const seenIds = new Set<string>();
  const seenIdentities = new Set<string>();
  let discount = 0n;

  // Stable order for determinism.
  const ordered = [...incentives].sort((a, b) =>
    a.incentive_id.localeCompare(b.incentive_id),
  );

  for (const incentive of ordered) {
    if (!isApplicableCurrentIncentive(incentive)) {
      continue;
    }
    if (seenIds.has(incentive.incentive_id)) {
      continue;
    }
    if (
      incentive.benefit_identity !== undefined &&
      seenIdentities.has(incentive.benefit_identity)
    ) {
      continue;
    }

    seenIds.add(incentive.incentive_id);
    if (incentive.benefit_identity !== undefined) {
      seenIdentities.add(incentive.benefit_identity);
    }

    const benefit = assertMoneyMinor(
      incentive.benefit_minor,
      "incentive.benefit_minor",
    );
    discount += BigInt(benefit);
    applied.push({
      incentive_id: incentive.incentive_id,
      kind: incentive.kind,
      benefit_minor: benefit,
    });
  }

  if (discount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("discount_amount_minor exceeds safe integer range");
  }

  return {
    discount_amount_minor: assertMoneyMinor(
      Number(discount),
      "discount_amount_minor",
    ),
    applied,
  };
}

/**
 * Generate an authoritative quote from current backend inputs.
 * Pure / deterministic. Ignores client_claims and practical_cost_minor.
 */
export function generateQuote(
  rawInput: QuoteCalculationInputRaw,
): QuoteResult {
  const parsed = quoteCalculationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const basketId =
      typeof rawInput === "object" &&
      rawInput !== null &&
      "basket_id" in rawInput &&
      typeof (rawInput as { basket_id?: unknown }).basket_id === "string"
        ? (rawInput as { basket_id: string }).basket_id
        : null;

    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    if (
      path.includes("quantity") ||
      issue?.message?.toLowerCase().includes("quantity")
    ) {
      return fail(
        "VALIDATION_ERROR",
        issue?.message ?? "Invalid quantity",
        basketId,
      );
    }
    return fail(
      "VALIDATION_ERROR",
      issue?.message ?? "Invalid quote input",
      basketId,
    );
  }

  const input = parsed.data;
  const basketId = input.basket_id.trim();
  if (basketId.length === 0) {
    return fail("BASKET_MISSING", "basket_id is required", null);
  }

  if (input.items.length === 0) {
    return fail("BASKET_EMPTY", "Quote basket has no items", basketId);
  }

  if (input.currency !== QUOTE_CURRENCY) {
    return fail(
      "CURRENCY_MISMATCH",
      `Unsupported quote currency: ${input.currency}`,
      basketId,
    );
  }

  // client_claims and practical_cost_minor are intentionally unused.
  void input.client_claims;
  void input.practical_cost_minor;
  void input.mandate_max_spend_minor;

  const catalogBySku = new Map(
    input.catalog.map((snap) => [snap.sku_id, snap]),
  );

  const lines: QuoteLineResult[] = [];
  let gross = 0n;

  for (const item of input.items) {
    const snap = catalogBySku.get(item.sku_id);
    if (!snap) {
      return fail(
        "SKU_MISSING",
        `Authoritative catalog snapshot missing for sku_id ${item.sku_id}`,
        basketId,
      );
    }

    if (snap.currency !== QUOTE_CURRENCY) {
      return fail(
        "CURRENCY_MISMATCH",
        `Catalog currency mismatch for sku_id ${item.sku_id}`,
        basketId,
      );
    }

    if (
      snap.sku_status !== undefined &&
      snap.sku_status !== "ACTIVE"
    ) {
      return fail(
        "AMOUNT_CALCULATION_FAILED",
        `SKU is not ACTIVE: ${item.sku_id}`,
        basketId,
      );
    }
    if (
      snap.product_status !== undefined &&
      snap.product_status !== "ACTIVE"
    ) {
      return fail(
        "AMOUNT_CALCULATION_FAILED",
        `Product is not ACTIVE for sku_id ${item.sku_id}`,
        basketId,
      );
    }

    if (
      !Number.isInteger(snap.price_minor) ||
      snap.price_minor < 0
    ) {
      return fail(
        "AMOUNT_CALCULATION_FAILED",
        `Invalid authoritative price for sku_id ${item.sku_id}`,
        basketId,
      );
    }

    // Stock: requested quantity must be fulfillable; never silently reduce.
    if (
      snap.available_quantity === null ||
      snap.available_quantity < item.quantity
    ) {
      return fail(
        "STOCK_UNAVAILABLE",
        `Insufficient stock for sku_id ${item.sku_id}`,
        basketId,
      );
    }

    let unit_price_minor: number;
    let line_amount_minor: number;
    try {
      unit_price_minor = assertMoneyMinor(
        snap.price_minor,
        "unit_price_minor",
      );
      line_amount_minor = calculateLineAmountMinor(
        item.quantity,
        unit_price_minor,
      );
    } catch {
      return fail(
        "AMOUNT_CALCULATION_FAILED",
        `Failed to calculate line amount for sku_id ${item.sku_id}`,
        basketId,
      );
    }

    lines.push({
      sku_id: item.sku_id,
      quantity: item.quantity,
      unit_price_minor,
      line_amount_minor,
    });
    gross += BigInt(line_amount_minor);
  }

  if (gross > BigInt(Number.MAX_SAFE_INTEGER)) {
    return fail(
      "AMOUNT_CALCULATION_FAILED",
      "gross_amount_minor exceeds safe integer range",
      basketId,
    );
  }

  let gross_amount_minor: number;
  try {
    gross_amount_minor = assertMoneyMinor(
      Number(gross),
      "gross_amount_minor",
    );
  } catch {
    return fail(
      "AMOUNT_CALCULATION_FAILED",
      "Invalid gross_amount_minor",
      basketId,
    );
  }

  let discount_amount_minor: number;
  let applied_incentives: QuoteAppliedIncentive[];
  try {
    const resolved = resolveApplicableIncentiveBenefits(input.incentives);
    discount_amount_minor = resolved.discount_amount_minor;
    applied_incentives = resolved.applied;
  } catch {
    return fail(
      "AMOUNT_CALCULATION_FAILED",
      "Failed to resolve incentive discounts",
      basketId,
    );
  }

  if (discount_amount_minor > gross_amount_minor) {
    return fail(
      "INVALID_QUOTE_STATE",
      "discount_amount_minor cannot exceed gross_amount_minor",
      basketId,
    );
  }

  const final_payable_minor = gross_amount_minor - discount_amount_minor;
  if (!Number.isInteger(final_payable_minor) || final_payable_minor < 0) {
    return fail(
      "INVALID_QUOTE_STATE",
      "final_payable_minor must be a non-negative integer",
      basketId,
    );
  }

  // Stable line order for deterministic quote_version / output.
  lines.sort((a, b) => a.sku_id.localeCompare(b.sku_id));

  const quote_version = deriveQuoteVersion({
    basket_id: basketId,
    currency: QUOTE_CURRENCY,
    lines,
    gross_amount_minor,
    discount_amount_minor,
    final_payable_minor,
    applied_incentives,
  });

  return parseOrThrow(quoteResultSchema, {
    ok: true,
    basket_id: basketId,
    currency: QUOTE_CURRENCY,
    amount_kind: QUOTE_AMOUNT_KIND,
    lines,
    gross_amount_minor,
    discount_amount_minor,
    final_payable_minor,
    quote_version,
    applied_incentives,
    policy_decision: null,
    payment_created: false,
    selection_created: false,
  });
}
