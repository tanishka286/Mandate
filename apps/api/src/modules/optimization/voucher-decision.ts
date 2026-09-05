import { assertMoneyMinor, type MoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import {
  authoritativeVoucherSchema,
  voucherBasketContextSchema,
  voucherDecisionResultSchema,
  type AuthoritativeVoucher,
  type AuthoritativeVoucherInput,
  type FutureValueStatus,
  type VoucherBasketContext,
  type VoucherBasketContextInput,
  type VoucherDecisionEconomics,
  type VoucherDecisionReason,
  type VoucherDecisionResult,
  type VoucherDecisionState,
} from "./schema.js";

/**
 * Phase 5 Step 5 — Smart Voucher Decision Engine (Doc 05 §9 / FR-07).
 *
 * Deterministically selects USE_NOW | SAVE_FOR_LATER | DO_NOT_USE for an
 * otherwise feasible basket/candidate context after ordinary merchant deals.
 *
 * Does NOT:
 * - invent future-use value (Doc 05 §9.4)
 * - treat unknown future value as zero / automatic USE_NOW
 * - add products to unlock thresholds (Doc 12 D-030)
 * - stack vouchers unless explicitly authorized
 * - evaluate loyalty (Step 6)
 * - generate baskets/quotes or call network/LLM
 */

export type VoucherDecisionInput = {
  basket: VoucherBasketContextInput;
  voucher: AuthoritativeVoucherInput;
};

export type OptimizeVoucherDecisionsInput = {
  basket: VoucherBasketContextInput;
  vouchers: readonly AuthoritativeVoucherInput[];
  /**
   * Stacking is not authorized in the locked MVP unless explicitly true.
   * When false/undefined, at most one voucher is selected.
   */
  stacking_authorized?: boolean;
};

export type OptimizeVoucherDecisionsResult = {
  /** Selected voucher decision (null when no vouchers supplied). */
  selected: VoucherDecisionResult | null;
  /** All per-voucher evaluations, ordered by voucher_id ascending. */
  evaluations: VoucherDecisionResult[];
  stacking_applied: false;
};

function uniqueReasons(
  reasons: readonly VoucherDecisionReason[],
): VoucherDecisionReason[] {
  return [...new Set(reasons)];
}

function isDuplicateBenefit(
  voucher: AuthoritativeVoucher,
  basket: VoucherBasketContext,
): boolean {
  const identities = [
    voucher.benefit_identity,
    voucher.source_reference,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const dealIdentities = [
    basket.merchant_deal_benefit_identity,
    basket.merchant_deal_source_reference,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const left of identities) {
    for (const right of dealIdentities) {
      if (left === right) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Doc 05 §9.3 locks a 5% snack saving as insufficient when future utility
 * matters. When future value is UNKNOWN (§9.4), reuse that locked qualitative
 * bound via integer cross-multiplication — never invent future_use_value_minor.
 *
 * Weak (≤ 5% of basket) ⇔ immediate_benefit * 20 ≤ effective_before.
 */
export function isWeakImmediateBenefitUnderUncertainty(
  immediateBenefitMinor: MoneyMinor,
  effectiveAmountBeforeVoucherMinor: MoneyMinor,
): boolean {
  assertMoneyMinor(immediateBenefitMinor, "immediate_benefit_minor");
  const before = assertMoneyMinor(
    effectiveAmountBeforeVoucherMinor,
    "effective_amount_before_voucher_minor",
  );
  if (before === 0) {
    return true;
  }
  return (
    BigInt(immediateBenefitMinor) * 20n <= BigInt(before)
  );
}

function resolveFutureValueKnowledge(
  futureRaw: MoneyMinor | null | undefined,
): { status: FutureValueStatus; value: MoneyMinor | null } {
  if (futureRaw !== undefined && futureRaw !== null) {
    return {
      status: "KNOWN",
      value: assertMoneyMinor(futureRaw, "future_use_value_minor"),
    };
  }
  return { status: "UNKNOWN", value: null };
}

function buildEconomics(args: {
  basket: VoucherBasketContext;
  thresholdMinor: MoneyMinor;
  discountMinor: MoneyMinor;
  immediateBenefitMinor: MoneyMinor;
  futureUseValueMinor: MoneyMinor | null;
  opportunityCostMinor: MoneyMinor;
  hypotheticalAfterMinor: MoneyMinor;
}): VoucherDecisionEconomics {
  const qualifying =
    args.basket.qualifying_amount_minor ??
    args.basket.effective_amount_before_voucher_minor;

  return {
    gross_amount_minor: args.basket.gross_amount_minor,
    realized_deal_benefit_minor: args.basket.realized_deal_benefit_minor,
    effective_amount_before_voucher_minor:
      args.basket.effective_amount_before_voucher_minor,
    qualifying_amount_minor: assertMoneyMinor(
      qualifying,
      "qualifying_amount_minor",
    ),
    threshold_minor: args.thresholdMinor,
    discount_minor: args.discountMinor,
    immediate_benefit_minor: args.immediateBenefitMinor,
    future_use_value_minor: args.futureUseValueMinor,
    opportunity_cost_minor: args.opportunityCostMinor,
    hypothetical_amount_after_voucher_minor: args.hypotheticalAfterMinor,
  };
}

function finalizeResult(args: {
  voucher: AuthoritativeVoucher;
  basket: VoucherBasketContext;
  decision: VoucherDecisionState;
  reasons: readonly VoucherDecisionReason[];
  futureValueStatus: FutureValueStatus;
  economics: VoucherDecisionEconomics;
}): VoucherDecisionResult {
  return parseOrThrow(voucherDecisionResultSchema, {
    voucher_id: args.voucher.voucher_id,
    authority: args.voucher.authority,
    source_reference: args.voucher.source_reference,
    benefit_identity: args.voucher.benefit_identity ?? null,
    decision: args.decision,
    reasons: uniqueReasons(args.reasons),
    future_value_status: args.futureValueStatus,
    economics: args.economics,
    quality_signal: args.basket.quality_signal ?? null,
    confidence: args.basket.confidence,
    evidence_refs: [...(args.basket.evidence_refs ?? [])].sort((a, b) =>
      a.localeCompare(b),
    ),
    prior_feasible: args.basket.feasible,
  });
}

function doNotUse(args: {
  voucher: AuthoritativeVoucher;
  basket: VoucherBasketContext;
  reasons: readonly VoucherDecisionReason[];
  thresholdMinor?: MoneyMinor;
  discountMinor?: MoneyMinor;
  immediateBenefitMinor?: MoneyMinor;
  futureUseValueMinor?: MoneyMinor | null;
}): VoucherDecisionResult {
  const threshold = assertMoneyMinor(
    args.thresholdMinor ?? args.voucher.threshold_minor ?? 0,
    "threshold_minor",
  );
  const discount = assertMoneyMinor(
    args.discountMinor ?? args.voucher.discount_minor ?? 0,
    "discount_minor",
  );
  const before = args.basket.effective_amount_before_voucher_minor;
  const immediate = assertMoneyMinor(
    args.immediateBenefitMinor ?? 0,
    "immediate_benefit_minor",
  );
  const futureRaw =
    args.futureUseValueMinor === undefined
      ? args.voucher.future_use_value_minor
      : args.futureUseValueMinor;
  const future = resolveFutureValueKnowledge(futureRaw);

  return finalizeResult({
    voucher: args.voucher,
    basket: args.basket,
    decision: "DO_NOT_USE",
    reasons: args.reasons,
    futureValueStatus: future.status,
    economics: buildEconomics({
      basket: args.basket,
      thresholdMinor: threshold,
      discountMinor: discount,
      immediateBenefitMinor: immediate,
      futureUseValueMinor: future.value,
      opportunityCostMinor: 0,
      hypotheticalAfterMinor: before,
    }),
  });
}

/**
 * Cap voucher discount so effective amount never goes negative.
 * Applied once on top of already-realized ordinary deal benefit.
 */
export function resolveImmediateVoucherBenefit(
  effectiveAmountBeforeVoucherMinor: MoneyMinor,
  discountMinor: MoneyMinor,
): {
  immediate_benefit_minor: MoneyMinor;
  hypothetical_amount_after_voucher_minor: MoneyMinor;
} {
  const before = assertMoneyMinor(
    effectiveAmountBeforeVoucherMinor,
    "effective_amount_before_voucher_minor",
  );
  const discount = assertMoneyMinor(discountMinor, "discount_minor");
  const benefit = discount > before ? before : discount;
  return {
    immediate_benefit_minor: assertMoneyMinor(benefit, "immediate_benefit_minor"),
    hypothetical_amount_after_voucher_minor: assertMoneyMinor(
      before - benefit,
      "hypothetical_amount_after_voucher_minor",
    ),
  };
}

/**
 * Evaluate one authoritative voucher against a post-deal basket context.
 *
 * Deterministic rules (Doc 05 §9 / Doc 10 §10 / Doc 12 D-026–D-030):
 * 1. Missing/invalid authority → DO_NOT_USE
 * 2. Prior feasibility/budget/quality failures → DO_NOT_USE (no override)
 * 3. EXPIRED / INVALID / INELIGIBLE → DO_NOT_USE
 * 4. Duplicate benefit identity with merchant deal → DO_NOT_USE
 * 5. Below threshold → DO_NOT_USE (never add products)
 * 6. Zero immediate benefit → DO_NOT_USE
 * 7. Authoritative future_use_value_minor > immediate → SAVE_FOR_LATER
 * 8. Authoritative future_use_value_minor <= immediate → USE_NOW
 * 9. Unknown future (§9.4): weak immediate (≤ Doc 05 §9.3 5% bound) →
 *    SAVE_FOR_LATER with FUTURE_VALUE_UNCERTAIN; meaningful → USE_NOW with
 *    FUTURE_VALUE_UNCERTAIN. Never invent future_use_value_minor.
 *
 * No numeric future-value estimate is invented when future_use_value_minor
 * is absent/null (Doc 05 §9.4).
 */
export function evaluateVoucherDecision(
  input: VoucherDecisionInput,
): VoucherDecisionResult {
  const basketParsed = voucherBasketContextSchema.safeParse(input.basket);
  const voucherParsed = authoritativeVoucherSchema.safeParse(input.voucher);

  if (!basketParsed.success || !voucherParsed.success) {
    // Fail closed with a minimal safe shell when possible.
    const fallbackBasket: VoucherBasketContext = basketParsed.success
      ? basketParsed.data
      : {
          gross_amount_minor: 0,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 0,
          qualifying_amount_minor: 0,
          feasible: false,
          prior_rejection_reasons: ["MISSING_AUTHORITATIVE_DATA"],
          evidence_refs: [],
        };

    const fallbackVoucher: AuthoritativeVoucher = voucherParsed.success
      ? voucherParsed.data
      : {
          voucher_id:
            typeof input.voucher === "object" &&
            input.voucher !== null &&
            "voucher_id" in input.voucher &&
            typeof (input.voucher as { voucher_id?: unknown }).voucher_id ===
              "string" &&
            (input.voucher as { voucher_id: string }).voucher_id.trim().length >
              0
              ? (input.voucher as { voucher_id: string }).voucher_id
              : "unknown",
          authority: "BACKEND_DEFINED_VOUCHER",
          source_reference: "missing:authoritative_voucher",
          threshold_minor: 0,
          discount_minor: 0,
          validity: "INVALID",
          eligibility: "INELIGIBLE",
          future_use_value_minor: null,
        };

    return doNotUse({
      voucher: fallbackVoucher,
      basket: fallbackBasket,
      reasons: ["MISSING_AUTHORITATIVE_DATA"],
    });
  }

  const basket = basketParsed.data;
  const voucher = voucherParsed.data;

  // Free-text description must never affect decisions (explicitly unused).
  void voucher.description;

  if (!basket.feasible || (basket.prior_rejection_reasons?.length ?? 0) > 0) {
    return doNotUse({
      voucher,
      basket,
      reasons: ["PRIOR_CONSTRAINT_FAILED"],
    });
  }

  if (
    basket.budget_ceiling_minor !== undefined &&
    basket.effective_amount_before_voucher_minor > basket.budget_ceiling_minor
  ) {
    return doNotUse({
      voucher,
      basket,
      reasons: ["BUDGET_CONFLICT"],
    });
  }

  if (voucher.validity === "EXPIRED") {
    return doNotUse({
      voucher,
      basket,
      reasons: ["VOUCHER_EXPIRED"],
    });
  }

  if (voucher.validity === "INVALID") {
    return doNotUse({
      voucher,
      basket,
      reasons: ["VOUCHER_INVALID"],
    });
  }

  if (voucher.eligibility === "INELIGIBLE") {
    return doNotUse({
      voucher,
      basket,
      reasons: ["VOUCHER_INELIGIBLE"],
    });
  }

  if (isDuplicateBenefit(voucher, basket)) {
    return doNotUse({
      voucher,
      basket,
      reasons: ["DUPLICATE_BENEFIT"],
    });
  }

  const qualifying = assertMoneyMinor(
    basket.qualifying_amount_minor ??
      basket.effective_amount_before_voucher_minor,
    "qualifying_amount_minor",
  );
  const threshold = assertMoneyMinor(
    voucher.threshold_minor,
    "threshold_minor",
  );
  const discount = assertMoneyMinor(voucher.discount_minor, "discount_minor");

  if (qualifying < threshold) {
    // Never recommend unrelated product addition (D-030 / Doc 05 §9.3).
    return doNotUse({
      voucher,
      basket,
      reasons: ["BELOW_THRESHOLD", "UNJUSTIFIED_THRESHOLD_EXPANSION"],
      thresholdMinor: threshold,
      discountMinor: discount,
      immediateBenefitMinor: 0,
      futureUseValueMinor: voucher.future_use_value_minor ?? null,
    });
  }

  const resolved = resolveImmediateVoucherBenefit(
    basket.effective_amount_before_voucher_minor,
    discount,
  );

  if (resolved.immediate_benefit_minor === 0) {
    return doNotUse({
      voucher,
      basket,
      reasons: ["NO_IMMEDIATE_BENEFIT"],
      thresholdMinor: threshold,
      discountMinor: discount,
      immediateBenefitMinor: 0,
      futureUseValueMinor: voucher.future_use_value_minor ?? null,
    });
  }

  const future = resolveFutureValueKnowledge(voucher.future_use_value_minor);

  // A. Known future value — direct authoritative comparison.
  if (future.status === "KNOWN" && future.value !== null) {
    if (future.value > resolved.immediate_benefit_minor) {
      return finalizeResult({
        voucher,
        basket,
        decision: "SAVE_FOR_LATER",
        reasons: ["FUTURE_VALUE_PREFERRED"],
        futureValueStatus: "KNOWN",
        economics: buildEconomics({
          basket,
          thresholdMinor: threshold,
          discountMinor: discount,
          immediateBenefitMinor: resolved.immediate_benefit_minor,
          futureUseValueMinor: future.value,
          opportunityCostMinor: resolved.immediate_benefit_minor,
          hypotheticalAfterMinor:
            basket.effective_amount_before_voucher_minor,
        }),
      });
    }

    return finalizeResult({
      voucher,
      basket,
      decision: "USE_NOW",
      reasons: ["VOUCHER_VALID_AND_IMMEDIATE_BENEFIT"],
      futureValueStatus: "KNOWN",
      economics: buildEconomics({
        basket,
        thresholdMinor: threshold,
        discountMinor: discount,
        immediateBenefitMinor: resolved.immediate_benefit_minor,
        futureUseValueMinor: future.value,
        opportunityCostMinor: 0,
        hypotheticalAfterMinor:
          resolved.hypothetical_amount_after_voucher_minor,
      }),
    });
  }

  // B. Unknown future value (Doc 05 §9.4 / Doc 10 §10):
  // Do not invent a numeric future saving and do not treat unknown as zero.
  // Conservative bounded heuristic from Doc 05 §9.3's locked 5% snack bound.
  const weak = isWeakImmediateBenefitUnderUncertainty(
    resolved.immediate_benefit_minor,
    basket.effective_amount_before_voucher_minor,
  );

  if (weak) {
    return finalizeResult({
      voucher,
      basket,
      decision: "SAVE_FOR_LATER",
      reasons: ["FUTURE_VALUE_UNCERTAIN"],
      futureValueStatus: "UNKNOWN",
      economics: buildEconomics({
        basket,
        thresholdMinor: threshold,
        discountMinor: discount,
        immediateBenefitMinor: resolved.immediate_benefit_minor,
        futureUseValueMinor: null,
        opportunityCostMinor: resolved.immediate_benefit_minor,
        hypotheticalAfterMinor:
          basket.effective_amount_before_voucher_minor,
      }),
    });
  }

  return finalizeResult({
    voucher,
    basket,
    decision: "USE_NOW",
    reasons: [
      "VOUCHER_VALID_AND_IMMEDIATE_BENEFIT",
      "FUTURE_VALUE_UNCERTAIN",
    ],
    futureValueStatus: "UNKNOWN",
    economics: buildEconomics({
      basket,
      thresholdMinor: threshold,
      discountMinor: discount,
      immediateBenefitMinor: resolved.immediate_benefit_minor,
      futureUseValueMinor: null,
      opportunityCostMinor: 0,
      hypotheticalAfterMinor:
        resolved.hypothetical_amount_after_voucher_minor,
    }),
  });
}

function decisionRank(decision: VoucherDecisionState): number {
  switch (decision) {
    case "USE_NOW":
      return 2;
    case "SAVE_FOR_LATER":
      return 1;
    case "DO_NOT_USE":
      return 0;
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}

/**
 * Select at most one voucher deterministically (stacking not authorized).
 *
 * Tie-break:
 * 1. Higher decision rank (USE_NOW > SAVE_FOR_LATER > DO_NOT_USE)
 * 2. Among USE_NOW: higher immediate_benefit_minor
 * 3. Among SAVE_FOR_LATER: higher future_use_value_minor (nulls last)
 * 4. voucher_id ascending
 */
export function selectVoucherDecision(
  evaluations: readonly VoucherDecisionResult[],
): VoucherDecisionResult | null {
  if (evaluations.length === 0) {
    return null;
  }

  const sorted = [...evaluations].sort((a, b) => {
    const rankDiff = decisionRank(b.decision) - decisionRank(a.decision);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    if (a.decision === "USE_NOW" && b.decision === "USE_NOW") {
      const benefitDiff =
        b.economics.immediate_benefit_minor -
        a.economics.immediate_benefit_minor;
      if (benefitDiff !== 0) {
        return benefitDiff;
      }
    }

    if (a.decision === "SAVE_FOR_LATER" && b.decision === "SAVE_FOR_LATER") {
      const aFuture = a.economics.future_use_value_minor;
      const bFuture = b.economics.future_use_value_minor;
      if (aFuture === null && bFuture !== null) return 1;
      if (aFuture !== null && bFuture === null) return -1;
      if (aFuture !== null && bFuture !== null && aFuture !== bFuture) {
        return bFuture - aFuture;
      }
    }

    return a.voucher_id.localeCompare(b.voucher_id);
  });

  return sorted[0] ?? null;
}

/**
 * Evaluate multiple vouchers against the same basket.
 * Stacking is never applied unless an explicit future contract authorizes it;
 * this MVP always returns stacking_applied: false and selects at most one.
 */
export function optimizeVoucherDecisions(
  input: OptimizeVoucherDecisionsInput,
): OptimizeVoucherDecisionsResult {
  void input.stacking_authorized; // MVP: stacking never applied.

  const evaluations = [...input.vouchers]
    .map((voucher) =>
      evaluateVoucherDecision({
        basket: input.basket,
        voucher,
      }),
    )
    .sort((a, b) => a.voucher_id.localeCompare(b.voucher_id));

  return {
    selected: selectVoucherDecision(evaluations),
    evaluations,
    stacking_applied: false,
  };
}
