import { assertMoneyMinor } from "../../shared/money/index.js";
import {
  evaluateVoucherDecision,
  evaluateLoyaltyDecision,
  type AuthoritativeVoucherInput,
  type AuthoritativeLoyaltyRewardInput,
  type VoucherBasketContextInput,
  type LoyaltyBasketContextInput,
  type VoucherDecisionResult,
  type LoyaltyDecisionResult,
} from "../optimization/index.js";
import { IncentivesRepository } from "./repository.js";
import {
  incentiveRulesSchema,
  type IncentiveRow,
  type IncentiveRules,
  type IncentiveDecision,
} from "./schema.js";

export type ResolvedIncentiveValidity =
  | "VALID"
  | "EXPIRED"
  | "INVALID";

export type ResolvedIncentiveEligibility =
  | "ELIGIBLE"
  | "INELIGIBLE";

export type AuthoritativeIncentiveBundle = {
  vouchers: AuthoritativeVoucherInput[];
  loyalty_rewards: AuthoritativeLoyaltyRewardInput[];
};

export type PolicyIncentiveEvaluationInput = {
  claimed_incentive_ids: readonly string[];
  gross_amount_minor: number;
  realized_deal_benefit_minor?: number;
  voucher_benefit_minor?: number;
};

export type PolicyIncentiveEvaluationResult =
  | { ok: true; discount_amount_minor: number }
  | { ok: false; reason_code: "INCENTIVE_INVALID" };

/**
 * Phase 10 Step 1 — Authoritative incentive domain service.
 *
 * Loads persisted incentive facts, maps to optimization engines, and computes
 * policy-safe discounts. AI may explain decisions; never invents eligibility.
 */
export class IncentivesService {
  constructor(private readonly repository = new IncentivesRepository()) {}

  parseRules(raw: unknown): IncentiveRules {
    return incentiveRulesSchema.parse(raw);
  }

  resolveValidity(row: IncentiveRow, now: Date = new Date()): ResolvedIncentiveValidity {
    if (row.status === "EXPIRED" || row.status === "INACTIVE") {
      return row.status === "EXPIRED" ? "EXPIRED" : "INVALID";
    }
    if (row.valid_until) {
      const until = Date.parse(row.valid_until);
      if (!Number.isNaN(until) && now.getTime() > until) {
        return "EXPIRED";
      }
    }
    if (row.valid_from) {
      const from = Date.parse(row.valid_from);
      if (!Number.isNaN(from) && now.getTime() < from) {
        return "INVALID";
      }
    }
    return "VALID";
  }

  resolveEligibility(
    row: IncentiveRow,
    grossAmountMinor: number,
    now: Date = new Date(),
  ): ResolvedIncentiveEligibility {
    const validity = this.resolveValidity(row, now);
    if (validity !== "VALID") {
      return "INELIGIBLE";
    }
    const rules = this.parseRules(row.rules_json);
    const gross = assertMoneyMinor(grossAmountMinor, "gross_amount_minor");
    if (rules.minimum_spend_minor > 0 && gross < rules.minimum_spend_minor) {
      return "INELIGIBLE";
    }
    return "ELIGIBLE";
  }

  toAuthoritativeVoucher(
    row: IncentiveRow,
    grossAmountMinor: number,
    now: Date = new Date(),
  ): AuthoritativeVoucherInput {
    const rules = this.parseRules(row.rules_json);
    const validity = this.resolveValidity(row, now);
    const eligibility = this.resolveEligibility(row, grossAmountMinor, now);

    return {
      voucher_id: row.incentive_id,
      authority: "BACKEND_DEFINED_VOUCHER",
      source_reference: rules.source_reference,
      benefit_identity: rules.benefit_identity,
      threshold_minor: rules.threshold_minor ?? 0,
      discount_minor: rules.discount_minor ?? 0,
      validity:
        validity === "VALID"
          ? "VALID"
          : validity === "EXPIRED"
            ? "EXPIRED"
            : "INVALID",
      eligibility: eligibility === "ELIGIBLE" ? "ELIGIBLE" : "INELIGIBLE",
      future_use_value_minor: rules.future_use_value_minor ?? null,
      description: row.description ?? undefined,
    };
  }

  toAuthoritativeLoyaltyReward(
    row: IncentiveRow,
    grossAmountMinor: number,
    now: Date = new Date(),
  ): AuthoritativeLoyaltyRewardInput {
    const rules = this.parseRules(row.rules_json);
    const validity = this.resolveValidity(row, now);
    const eligibility = this.resolveEligibility(row, grossAmountMinor, now);

    return {
      reward_id: row.incentive_id,
      authority: "BACKEND_DEFINED_LOYALTY_REWARD",
      source_reference: rules.source_reference,
      benefit_identity: rules.benefit_identity,
      value_kind: rules.value_kind ?? "MONETARY",
      redeemable_value_minor:
        rules.value_kind === "POINTS_ONLY"
          ? undefined
          : (rules.redeemable_value_minor ?? 0),
      minimum_spend_minor: rules.minimum_spend_minor ?? 0,
      validity:
        validity === "VALID"
          ? "VALID"
          : validity === "EXPIRED"
            ? "EXPIRED"
            : "INVALID",
      eligibility: eligibility === "ELIGIBLE" ? "ELIGIBLE" : "INELIGIBLE",
      consumable: rules.consumable ?? true,
      future_use_value_minor: rules.future_use_value_minor ?? null,
    };
  }

  buildVoucherBasketContext(
    grossAmountMinor: number,
    realizedDealBenefitMinor = 0,
  ): VoucherBasketContextInput {
    const gross = assertMoneyMinor(grossAmountMinor, "gross_amount_minor");
    const deal = assertMoneyMinor(
      realizedDealBenefitMinor,
      "realized_deal_benefit_minor",
    );
    const effective = gross - deal;
    return {
      gross_amount_minor: gross,
      realized_deal_benefit_minor: deal,
      effective_amount_before_voucher_minor: effective,
      qualifying_amount_minor: effective,
      feasible: true,
      prior_rejection_reasons: [],
    };
  }

  buildLoyaltyBasketContext(
    grossAmountMinor: number,
    realizedDealBenefitMinor = 0,
    voucherBenefitMinor = 0,
  ): LoyaltyBasketContextInput {
    const gross = assertMoneyMinor(grossAmountMinor, "gross_amount_minor");
    const deal = assertMoneyMinor(
      realizedDealBenefitMinor,
      "realized_deal_benefit_minor",
    );
    const voucher = assertMoneyMinor(
      voucherBenefitMinor,
      "voucher_benefit_minor",
    );
    const effective = gross - deal - voucher;
    return {
      gross_amount_minor: gross,
      realized_deal_benefit_minor: deal,
      voucher_benefit_minor: voucher,
      effective_amount_before_loyalty_minor: effective,
      qualifying_amount_minor: effective,
      feasible: true,
      prior_rejection_reasons: [],
    };
  }

  async listAuthoritativeBundle(
    grossAmountMinor: number,
    now: Date = new Date(),
  ): Promise<AuthoritativeIncentiveBundle> {
    const rows = await this.repository.listActive();
    const vouchers: AuthoritativeVoucherInput[] = [];
    const loyalty_rewards: AuthoritativeLoyaltyRewardInput[] = [];

    for (const row of rows) {
      if (row.type === "VOUCHER") {
        vouchers.push(this.toAuthoritativeVoucher(row, grossAmountMinor, now));
      } else if (row.type === "LOYALTY_REWARD") {
        loyalty_rewards.push(
          this.toAuthoritativeLoyaltyReward(row, grossAmountMinor, now),
        );
      }
    }

    return { vouchers, loyalty_rewards };
  }

  evaluateVoucherDecisionForRow(
    row: IncentiveRow,
    basket: VoucherBasketContextInput,
    now: Date = new Date(),
  ): VoucherDecisionResult {
    const voucher = this.toAuthoritativeVoucher(
      row,
      basket.gross_amount_minor,
      now,
    );
    return evaluateVoucherDecision({ basket, voucher });
  }

  evaluateLoyaltyDecisionForRow(
    row: IncentiveRow,
    basket: LoyaltyBasketContextInput,
    now: Date = new Date(),
  ): LoyaltyDecisionResult {
    const reward = this.toAuthoritativeLoyaltyReward(
      row,
      basket.gross_amount_minor,
      now,
    );
    return evaluateLoyaltyDecision({ basket, reward });
  }

  /**
   * Policy port: validate claimed incentives and return authoritative discount.
   * Only USE_NOW decisions with positive immediate benefit may reduce payable.
   */
  async evaluateForPolicy(
    input: PolicyIncentiveEvaluationInput,
    now: Date = new Date(),
  ): Promise<PolicyIncentiveEvaluationResult> {
    if (input.claimed_incentive_ids.length === 0) {
      return { ok: true, discount_amount_minor: 0 };
    }

    const gross = assertMoneyMinor(
      input.gross_amount_minor,
      "gross_amount_minor",
    );
    const rows = await this.repository.findByIds(input.claimed_incentive_ids);
    const byId = new Map(rows.map((row) => [row.incentive_id, row]));

    for (const id of input.claimed_incentive_ids) {
      if (!byId.has(id)) {
        return { ok: false, reason_code: "INCENTIVE_INVALID" };
      }
    }

    const voucherBasket = this.buildVoucherBasketContext(
      gross,
      input.realized_deal_benefit_minor ?? 0,
    );

    let voucherBenefitApplied = 0;
    const seenBenefitIdentities = new Set<string>();
    let totalDiscount = 0n;

    // Evaluate vouchers first (stable id order).
    const voucherRows = [...rows]
      .filter((r) => r.type === "VOUCHER")
      .sort((a, b) => a.incentive_id.localeCompare(b.incentive_id));

    for (const row of voucherRows) {
      const decision = this.evaluateVoucherDecisionForRow(
        row,
        voucherBasket,
        now,
      );
      if (decision.decision !== "USE_NOW") {
        return { ok: false, reason_code: "INCENTIVE_INVALID" };
      }
      const benefit = assertMoneyMinor(
        decision.economics.immediate_benefit_minor,
        "immediate_benefit_minor",
      );
      if (benefit <= 0) {
        return { ok: false, reason_code: "INCENTIVE_INVALID" };
      }
      const rules = this.parseRules(row.rules_json);
      if (seenBenefitIdentities.has(rules.benefit_identity)) {
        return { ok: false, reason_code: "INCENTIVE_INVALID" };
      }
      seenBenefitIdentities.add(rules.benefit_identity);
      totalDiscount += BigInt(benefit);
      voucherBenefitApplied += benefit;
    }

    const loyaltyBasket = this.buildLoyaltyBasketContext(
      gross,
      input.realized_deal_benefit_minor ?? 0,
      voucherBenefitApplied,
    );

    const loyaltyRows = [...rows]
      .filter((r) => r.type === "LOYALTY_REWARD")
      .sort((a, b) => a.incentive_id.localeCompare(b.incentive_id));

    for (const row of loyaltyRows) {
      const decision = this.evaluateLoyaltyDecisionForRow(
        row,
        loyaltyBasket,
        now,
      );
      if (decision.decision !== "USE_NOW") {
        return { ok: false, reason_code: "INCENTIVE_INVALID" };
      }
      const immediateBenefit = decision.economics.immediate_benefit_minor;
      if (immediateBenefit === null || immediateBenefit <= 0) {
        return { ok: false, reason_code: "INCENTIVE_INVALID" };
      }
      const benefit = assertMoneyMinor(
        immediateBenefit,
        "immediate_benefit_minor",
      );
      const rules = this.parseRules(row.rules_json);
      if (seenBenefitIdentities.has(rules.benefit_identity)) {
        return { ok: false, reason_code: "INCENTIVE_INVALID" };
      }
      seenBenefitIdentities.add(rules.benefit_identity);
      totalDiscount += BigInt(benefit);
    }

    if (totalDiscount > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { ok: false, reason_code: "INCENTIVE_INVALID" };
    }

    const discount = Number(totalDiscount);
    if (discount > gross) {
      return { ok: false, reason_code: "INCENTIVE_INVALID" };
    }

    return {
      ok: true,
      discount_amount_minor: assertMoneyMinor(discount, "discount_amount_minor"),
    };
  }

  decisionLabel(decision: IncentiveDecision): IncentiveDecision {
    return decision;
  }
}
