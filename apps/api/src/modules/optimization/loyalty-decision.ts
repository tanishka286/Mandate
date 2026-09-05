import { assertMoneyMinor, type MoneyMinor } from "../../shared/money/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import {
  authoritativeLoyaltyRewardSchema,
  loyaltyBasketContextSchema,
  loyaltyDecisionResultSchema,
  type AuthoritativeLoyaltyReward,
  type AuthoritativeLoyaltyRewardInput,
  type FutureValueStatus,
  type LoyaltyBasketContext,
  type LoyaltyBasketContextInput,
  type LoyaltyDecisionEconomics,
  type LoyaltyDecisionReason,
  type LoyaltyDecisionResult,
  type LoyaltyDecisionState,
} from "./schema.js";

/**
 * Phase 5 Step 6 — Loyalty Reward Decision Engine (Doc 05 §10 / FR-08).
 *
 * Same overall-value principle as vouchers (Doc 12 D-031):
 * Should this reward be consumed now, saved for later, or not used?
 *
 * Does NOT:
 * - invent point-to-money conversions
 * - invent future-use value or a loyalty-specific % formula
 * - add products to unlock minimum spend (D-030)
 * - stack rewards unless authorized
 * - implement a loyalty platform / ledger / earning
 * - generate baskets/quotes or call network/LLM
 */

export type LoyaltyDecisionInput = {
  basket: LoyaltyBasketContextInput;
  reward: AuthoritativeLoyaltyRewardInput;
};

export type OptimizeLoyaltyDecisionsInput = {
  basket: LoyaltyBasketContextInput;
  rewards: readonly AuthoritativeLoyaltyRewardInput[];
  stacking_authorized?: boolean;
};

export type OptimizeLoyaltyDecisionsResult = {
  selected: LoyaltyDecisionResult | null;
  evaluations: LoyaltyDecisionResult[];
  stacking_applied: false;
};

function uniqueReasons(
  reasons: readonly LoyaltyDecisionReason[],
): LoyaltyDecisionReason[] {
  return [...new Set(reasons)];
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

function isDuplicateBenefit(
  reward: AuthoritativeLoyaltyReward,
  basket: LoyaltyBasketContext,
): boolean {
  const identities = [
    reward.benefit_identity,
    reward.source_reference,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  const priorIdentities = [
    basket.merchant_deal_benefit_identity,
    basket.merchant_deal_source_reference,
    basket.voucher_benefit_identity,
    basket.voucher_source_reference,
    ...(basket.applied_loyalty_benefit_identities ?? []),
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  for (const left of identities) {
    for (const right of priorIdentities) {
      if (left === right) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Cap monetary redeemable so amount never goes negative.
 * Applied once on top of deal + voucher benefits.
 */
export function resolveImmediateLoyaltyBenefit(
  effectiveAmountBeforeLoyaltyMinor: MoneyMinor,
  redeemableValueMinor: MoneyMinor,
): {
  immediate_benefit_minor: MoneyMinor;
  hypothetical_amount_after_loyalty_minor: MoneyMinor;
} {
  const before = assertMoneyMinor(
    effectiveAmountBeforeLoyaltyMinor,
    "effective_amount_before_loyalty_minor",
  );
  const redeemable = assertMoneyMinor(
    redeemableValueMinor,
    "redeemable_value_minor",
  );
  const benefit = redeemable > before ? before : redeemable;
  return {
    immediate_benefit_minor: assertMoneyMinor(
      benefit,
      "immediate_benefit_minor",
    ),
    hypothetical_amount_after_loyalty_minor: assertMoneyMinor(
      before - benefit,
      "hypothetical_amount_after_loyalty_minor",
    ),
  };
}

function buildEconomics(args: {
  basket: LoyaltyBasketContext;
  minimumSpendMinor: MoneyMinor;
  redeemableValueMinor: MoneyMinor | null;
  pointsBalance: number | null;
  immediateBenefitMinor: MoneyMinor | null;
  futureUseValueMinor: MoneyMinor | null;
  opportunityCostMinor: MoneyMinor;
  hypotheticalAfterMinor: MoneyMinor;
}): LoyaltyDecisionEconomics {
  const qualifying =
    args.basket.qualifying_amount_minor ??
    args.basket.effective_amount_before_loyalty_minor;

  return {
    gross_amount_minor: args.basket.gross_amount_minor,
    realized_deal_benefit_minor: args.basket.realized_deal_benefit_minor,
    voucher_benefit_minor: args.basket.voucher_benefit_minor,
    effective_amount_before_loyalty_minor:
      args.basket.effective_amount_before_loyalty_minor,
    qualifying_amount_minor: assertMoneyMinor(
      qualifying,
      "qualifying_amount_minor",
    ),
    minimum_spend_minor: args.minimumSpendMinor,
    redeemable_value_minor: args.redeemableValueMinor,
    points_balance: args.pointsBalance,
    immediate_benefit_minor: args.immediateBenefitMinor,
    future_use_value_minor: args.futureUseValueMinor,
    opportunity_cost_minor: args.opportunityCostMinor,
    hypothetical_amount_after_loyalty_minor: args.hypotheticalAfterMinor,
  };
}

function finalizeResult(args: {
  reward: AuthoritativeLoyaltyReward;
  basket: LoyaltyBasketContext;
  decision: LoyaltyDecisionState;
  reasons: readonly LoyaltyDecisionReason[];
  futureValueStatus: FutureValueStatus;
  economics: LoyaltyDecisionEconomics;
}): LoyaltyDecisionResult {
  return parseOrThrow(loyaltyDecisionResultSchema, {
    reward_id: args.reward.reward_id,
    authority: args.reward.authority,
    source_reference: args.reward.source_reference,
    benefit_identity: args.reward.benefit_identity ?? null,
    value_kind: args.reward.value_kind,
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
  reward: AuthoritativeLoyaltyReward;
  basket: LoyaltyBasketContext;
  reasons: readonly LoyaltyDecisionReason[];
  minimumSpendMinor?: MoneyMinor;
  redeemableValueMinor?: MoneyMinor | null;
  immediateBenefitMinor?: MoneyMinor | null;
  futureUseValueMinor?: MoneyMinor | null;
}): LoyaltyDecisionResult {
  const minimumSpend = assertMoneyMinor(
    args.minimumSpendMinor ?? args.reward.minimum_spend_minor ?? 0,
    "minimum_spend_minor",
  );
  const redeemable =
    args.redeemableValueMinor === undefined
      ? (args.reward.redeemable_value_minor ?? null)
      : args.redeemableValueMinor;
  const before = args.basket.effective_amount_before_loyalty_minor;
  const futureRaw =
    args.futureUseValueMinor === undefined
      ? args.reward.future_use_value_minor
      : args.futureUseValueMinor;
  const future = resolveFutureValueKnowledge(futureRaw);

  return finalizeResult({
    reward: args.reward,
    basket: args.basket,
    decision: "DO_NOT_USE",
    reasons: args.reasons,
    futureValueStatus: future.status,
    economics: buildEconomics({
      basket: args.basket,
      minimumSpendMinor: minimumSpend,
      redeemableValueMinor: redeemable,
      pointsBalance:
        args.reward.points_balance === undefined
          ? null
          : args.reward.points_balance,
      immediateBenefitMinor: args.immediateBenefitMinor ?? null,
      futureUseValueMinor: future.value,
      opportunityCostMinor: 0,
      hypotheticalAfterMinor: before,
    }),
  });
}

/**
 * Evaluate one authoritative loyalty reward against post-deal/voucher context.
 *
 * Deterministic rules (Doc 05 §10 / Doc 10 §11 / Doc 12 D-031):
 * 1. Missing/invalid authority → DO_NOT_USE
 * 2. Prior feasibility/budget failures → DO_NOT_USE
 * 3. EXPIRED / INVALID / INELIGIBLE / not consumable → DO_NOT_USE
 * 4. POINTS_ONLY without monetary redeemable → DO_NOT_USE (no conversion)
 * 5. Duplicate benefit vs deal/voucher/other loyalty → DO_NOT_USE
 * 6. Below minimum spend → DO_NOT_USE (never add products)
 * 7. Zero monetary benefit → DO_NOT_USE
 * 8. Known future > immediate → SAVE_FOR_LATER
 * 9. Known future <= immediate → USE_NOW
 * 10. Unknown future: no invented formula; expose FUTURE_VALUE_UNCERTAIN;
 *     positive authoritative monetary benefit → USE_NOW (Doc 10: meaningful
 *     current value). Does not reuse voucher 5% heuristic (not in §10).
 */
export function evaluateLoyaltyDecision(
  input: LoyaltyDecisionInput,
): LoyaltyDecisionResult {
  const basketParsed = loyaltyBasketContextSchema.safeParse(input.basket);
  const rewardParsed = authoritativeLoyaltyRewardSchema.safeParse(input.reward);

  if (!basketParsed.success || !rewardParsed.success) {
    const fallbackBasket: LoyaltyBasketContext = basketParsed.success
      ? basketParsed.data
      : {
          gross_amount_minor: 0,
          realized_deal_benefit_minor: 0,
          voucher_benefit_minor: 0,
          effective_amount_before_loyalty_minor: 0,
          qualifying_amount_minor: 0,
          feasible: false,
          prior_rejection_reasons: ["MISSING_AUTHORITATIVE_DATA"],
          applied_loyalty_benefit_identities: [],
          evidence_refs: [],
        };

    const fallbackReward: AuthoritativeLoyaltyReward = rewardParsed.success
      ? rewardParsed.data
      : {
          reward_id:
            typeof input.reward === "object" &&
            input.reward !== null &&
            "reward_id" in input.reward &&
            typeof (input.reward as { reward_id?: unknown }).reward_id ===
              "string" &&
            (input.reward as { reward_id: string }).reward_id.trim().length > 0
              ? (input.reward as { reward_id: string }).reward_id
              : "unknown",
          authority: "BACKEND_DEFINED_LOYALTY_REWARD",
          source_reference: "missing:authoritative_loyalty_reward",
          value_kind: "POINTS_ONLY",
          minimum_spend_minor: 0,
          validity: "INVALID",
          eligibility: "INELIGIBLE",
          consumable: false,
          future_use_value_minor: null,
        };

    return doNotUse({
      reward: fallbackReward,
      basket: fallbackBasket,
      reasons: ["MISSING_AUTHORITATIVE_DATA"],
    });
  }

  const basket = basketParsed.data;
  const reward = rewardParsed.data;
  void reward.description;

  if (!basket.feasible || (basket.prior_rejection_reasons?.length ?? 0) > 0) {
    return doNotUse({
      reward,
      basket,
      reasons: ["PRIOR_CONSTRAINT_FAILED"],
    });
  }

  if (
    basket.budget_ceiling_minor !== undefined &&
    basket.effective_amount_before_loyalty_minor > basket.budget_ceiling_minor
  ) {
    return doNotUse({
      reward,
      basket,
      reasons: ["BUDGET_CONFLICT"],
    });
  }

  if (reward.validity === "EXPIRED") {
    return doNotUse({
      reward,
      basket,
      reasons: ["LOYALTY_EXPIRED"],
    });
  }

  if (reward.validity === "INVALID") {
    return doNotUse({
      reward,
      basket,
      reasons: ["LOYALTY_INVALID"],
    });
  }

  if (reward.eligibility === "INELIGIBLE") {
    return doNotUse({
      reward,
      basket,
      reasons: ["LOYALTY_INELIGIBLE"],
    });
  }

  if (!reward.consumable) {
    return doNotUse({
      reward,
      basket,
      reasons: ["LOYALTY_NOT_CONSUMABLE"],
    });
  }

  if (reward.value_kind === "POINTS_ONLY") {
    return doNotUse({
      reward,
      basket,
      reasons: ["REWARD_VALUE_NOT_ESTABLISHED"],
      redeemableValueMinor: null,
      immediateBenefitMinor: null,
    });
  }

  if (reward.redeemable_value_minor === undefined) {
    return doNotUse({
      reward,
      basket,
      reasons: ["REWARD_VALUE_NOT_ESTABLISHED", "MISSING_AUTHORITATIVE_DATA"],
      redeemableValueMinor: null,
      immediateBenefitMinor: null,
    });
  }

  if (isDuplicateBenefit(reward, basket)) {
    return doNotUse({
      reward,
      basket,
      reasons: ["DUPLICATE_BENEFIT"],
    });
  }

  const qualifying = assertMoneyMinor(
    basket.qualifying_amount_minor ??
      basket.effective_amount_before_loyalty_minor,
    "qualifying_amount_minor",
  );
  const minimumSpend = assertMoneyMinor(
    reward.minimum_spend_minor,
    "minimum_spend_minor",
  );
  const redeemable = assertMoneyMinor(
    reward.redeemable_value_minor,
    "redeemable_value_minor",
  );

  if (qualifying < minimumSpend) {
    return doNotUse({
      reward,
      basket,
      reasons: ["BELOW_MINIMUM_SPEND", "UNJUSTIFIED_REWARD_EXPANSION"],
      minimumSpendMinor: minimumSpend,
      redeemableValueMinor: redeemable,
      immediateBenefitMinor: 0,
      futureUseValueMinor: reward.future_use_value_minor ?? null,
    });
  }

  const resolved = resolveImmediateLoyaltyBenefit(
    basket.effective_amount_before_loyalty_minor,
    redeemable,
  );

  if (resolved.immediate_benefit_minor === 0) {
    return doNotUse({
      reward,
      basket,
      reasons: ["NO_IMMEDIATE_BENEFIT"],
      minimumSpendMinor: minimumSpend,
      redeemableValueMinor: redeemable,
      immediateBenefitMinor: 0,
      futureUseValueMinor: reward.future_use_value_minor ?? null,
    });
  }

  const future = resolveFutureValueKnowledge(reward.future_use_value_minor);

  // A. Known future — Doc 05 §10: preserve when future is materially better.
  if (future.status === "KNOWN" && future.value !== null) {
    if (future.value > resolved.immediate_benefit_minor) {
      return finalizeResult({
        reward,
        basket,
        decision: "SAVE_FOR_LATER",
        reasons: ["FUTURE_VALUE_PREFERRED"],
        futureValueStatus: "KNOWN",
        economics: buildEconomics({
          basket,
          minimumSpendMinor: minimumSpend,
          redeemableValueMinor: redeemable,
          pointsBalance: reward.points_balance ?? null,
          immediateBenefitMinor: resolved.immediate_benefit_minor,
          futureUseValueMinor: future.value,
          opportunityCostMinor: resolved.immediate_benefit_minor,
          hypotheticalAfterMinor:
            basket.effective_amount_before_loyalty_minor,
        }),
      });
    }

    return finalizeResult({
      reward,
      basket,
      decision: "USE_NOW",
      reasons: ["LOYALTY_VALID_AND_IMMEDIATE_BENEFIT"],
      futureValueStatus: "KNOWN",
      economics: buildEconomics({
        basket,
        minimumSpendMinor: minimumSpend,
        redeemableValueMinor: redeemable,
        pointsBalance: reward.points_balance ?? null,
        immediateBenefitMinor: resolved.immediate_benefit_minor,
        futureUseValueMinor: future.value,
        opportunityCostMinor: 0,
        hypotheticalAfterMinor:
          resolved.hypothetical_amount_after_loyalty_minor,
      }),
    });
  }

  // B. Unknown future (Doc 05 §10): no invented formula / no voucher 5% reuse.
  // Expose uncertainty. Positive authoritative monetary benefit → USE_NOW
  // (Doc 10: eligible + meaningful current value). Do not treat unknown as zero.
  return finalizeResult({
    reward,
    basket,
    decision: "USE_NOW",
    reasons: [
      "LOYALTY_VALID_AND_IMMEDIATE_BENEFIT",
      "FUTURE_VALUE_UNCERTAIN",
    ],
    futureValueStatus: "UNKNOWN",
    economics: buildEconomics({
      basket,
      minimumSpendMinor: minimumSpend,
      redeemableValueMinor: redeemable,
      pointsBalance: reward.points_balance ?? null,
      immediateBenefitMinor: resolved.immediate_benefit_minor,
      futureUseValueMinor: null,
      opportunityCostMinor: 0,
      hypotheticalAfterMinor:
        resolved.hypothetical_amount_after_loyalty_minor,
    }),
  });
}

function decisionRank(decision: LoyaltyDecisionState): number {
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
 * Select at most one loyalty reward deterministically (no stacking).
 *
 * Tie-break:
 * 1. Higher decision rank
 * 2. Among USE_NOW: higher immediate_benefit_minor
 * 3. Among SAVE_FOR_LATER: higher future_use_value_minor (nulls last)
 * 4. reward_id ascending
 */
export function selectLoyaltyDecision(
  evaluations: readonly LoyaltyDecisionResult[],
): LoyaltyDecisionResult | null {
  if (evaluations.length === 0) {
    return null;
  }

  const sorted = [...evaluations].sort((a, b) => {
    const rankDiff = decisionRank(b.decision) - decisionRank(a.decision);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    if (a.decision === "USE_NOW" && b.decision === "USE_NOW") {
      const aImm = a.economics.immediate_benefit_minor ?? 0;
      const bImm = b.economics.immediate_benefit_minor ?? 0;
      if (bImm !== aImm) {
        return bImm - aImm;
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

    return a.reward_id.localeCompare(b.reward_id);
  });

  return sorted[0] ?? null;
}

/**
 * Evaluate multiple loyalty rewards. Stacking is never applied in the MVP.
 */
export function optimizeLoyaltyDecisions(
  input: OptimizeLoyaltyDecisionsInput,
): OptimizeLoyaltyDecisionsResult {
  void input.stacking_authorized;

  const evaluations = [...input.rewards]
    .map((reward) =>
      evaluateLoyaltyDecision({
        basket: input.basket,
        reward,
      }),
    )
    .sort((a, b) => a.reward_id.localeCompare(b.reward_id));

  return {
    selected: selectLoyaltyDecision(evaluations),
    evaluations,
    stacking_applied: false,
  };
}
