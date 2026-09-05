import { describe, it, expect } from "vitest";
import {
  evaluateLoyaltyDecision,
  optimizeLoyaltyDecisions,
  resolveImmediateLoyaltyBenefit,
  selectLoyaltyDecision,
  type AuthoritativeLoyaltyRewardInput,
  type LoyaltyBasketContextInput,
  type LoyaltyDecisionResult,
} from "../../src/modules/optimization/index.js";

function basket(
  overrides: Partial<LoyaltyBasketContextInput> = {},
): LoyaltyBasketContextInput {
  return {
    gross_amount_minor: 60_000,
    realized_deal_benefit_minor: 0,
    voucher_benefit_minor: 0,
    effective_amount_before_loyalty_minor: 60_000,
    feasible: true,
    prior_rejection_reasons: [],
    applied_loyalty_benefit_identities: [],
    quality_signal: "GOOD",
    confidence: 0.9,
    evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
    ...overrides,
  };
}

function reward(
  overrides: Partial<AuthoritativeLoyaltyRewardInput> &
    Pick<AuthoritativeLoyaltyRewardInput, "reward_id"> = {
    reward_id: "reward-a",
  },
): AuthoritativeLoyaltyRewardInput {
  return {
    authority: "BACKEND_DEFINED_LOYALTY_REWARD",
    source_reference: "backend:loyalty:a",
    value_kind: "MONETARY",
    redeemable_value_minor: 10_000,
    minimum_spend_minor: 0,
    validity: "VALID",
    eligibility: "ELIGIBLE",
    consumable: true,
    ...overrides,
  };
}

describe("Phase 5 Step 6 — loyalty reward decision", () => {
  describe("SCENARIO A — meaningful current reward", () => {
    it("1. eligible reward + meaningful current value → USE_NOW", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "r-use",
          redeemable_value_minor: 10_000,
          future_use_value_minor: null,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.reasons).toContain("LOYALTY_VALID_AND_IMMEDIATE_BENEFIT");
      expect(result.economics.immediate_benefit_minor).toBe(10_000);
      expect(result.economics.hypothetical_amount_after_loyalty_minor).toBe(
        50_000,
      );
    });
  });

  describe("SCENARIO B — future utility", () => {
    it("2/14. stronger authoritative future utility → SAVE_FOR_LATER", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "r-future",
          redeemable_value_minor: 500,
          future_use_value_minor: 2_000,
        }),
      });
      expect(result.decision).toBe("SAVE_FOR_LATER");
      expect(result.reasons).toContain("FUTURE_VALUE_PREFERRED");
      expect(result.future_value_status).toBe("KNOWN");
      expect(result.economics.future_use_value_minor).toBe(2_000);
      expect(result.economics.opportunity_cost_minor).toBe(500);
    });

    it("15. known future utility <= current value → USE_NOW", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "r-known-le",
          redeemable_value_minor: 10_000,
          future_use_value_minor: 8_000,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.future_value_status).toBe("KNOWN");
      expect(result.economics.future_use_value_minor).toBe(8_000);
    });
  });

  describe("invalid / expired / ineligible", () => {
    it("3. invalid reward → DO_NOT_USE", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({ reward_id: "r-inv", validity: "INVALID" }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("LOYALTY_INVALID");
    });

    it("4. expired reward → DO_NOT_USE (SCENARIO C)", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({ reward_id: "r-exp", validity: "EXPIRED" }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("LOYALTY_EXPIRED");
    });

    it("5. ineligible user → DO_NOT_USE", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "r-inel",
          eligibility: "INELIGIBLE",
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("LOYALTY_INELIGIBLE");
    });
  });

  describe("SCENARIO D — conditions / unnecessary purchase", () => {
    it("6. basket does not satisfy reward condition → DO_NOT_USE", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket({
          gross_amount_minor: 48_000,
          realized_deal_benefit_minor: 0,
          voucher_benefit_minor: 0,
          effective_amount_before_loyalty_minor: 48_000,
        }),
        reward: reward({
          reward_id: "r-min",
          minimum_spend_minor: 50_000,
          redeemable_value_minor: 2_000,
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("BELOW_MINIMUM_SPEND");
    });

    it("7. reward condition cannot be established → fail closed", () => {
      const result = evaluateLoyaltyDecision({
        basket: {
          gross_amount_minor: 60_000,
          realized_deal_benefit_minor: 0,
          voucher_benefit_minor: 0,
          // inconsistent economics → condition cannot be trusted
          effective_amount_before_loyalty_minor: 50_000,
          feasible: true,
        },
        reward: reward({ reward_id: "r-bad-basket" }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("MISSING_AUTHORITATIVE_DATA");
    });

    it("8. reward requires unnecessary purchase → DO_NOT_USE, no mutation", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket({
          gross_amount_minor: 48_000,
          realized_deal_benefit_minor: 0,
          voucher_benefit_minor: 0,
          effective_amount_before_loyalty_minor: 48_000,
        }),
        reward: reward({
          reward_id: "r-pad",
          minimum_spend_minor: 50_000,
          redeemable_value_minor: 2_000,
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("UNJUSTIFIED_REWARD_EXPANSION");
      expect(Object.keys(result)).not.toContain("added_products");
      expect(Object.keys(result)).not.toContain("suggested_lines");
    });

    it("9. existing required item naturally satisfies reward condition", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket({
          gross_amount_minor: 52_000,
          realized_deal_benefit_minor: 0,
          voucher_benefit_minor: 0,
          effective_amount_before_loyalty_minor: 52_000,
        }),
        reward: reward({
          reward_id: "r-natural",
          minimum_spend_minor: 50_000,
          redeemable_value_minor: 2_000,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.economics.immediate_benefit_minor).toBe(2_000);
    });
  });

  describe("authority and points", () => {
    it("10. reward balance/value comes from authoritative input", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "r-auth",
          authority: "BACKEND_DEFINED_LOYALTY_REWARD",
          redeemable_value_minor: 7_500,
        }),
      });
      expect(result.authority).toBe("BACKEND_DEFINED_LOYALTY_REWARD");
      expect(result.economics.redeemable_value_minor).toBe(7_500);
      expect(result.economics.immediate_benefit_minor).toBe(7_500);
    });

    it("11. free-text / non-authority fields cannot override reward value", () => {
      const a = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "r-desc",
          redeemable_value_minor: 10_000,
          description: "Worth ₹999999!!!",
        }),
      });
      const b = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "r-desc",
          redeemable_value_minor: 10_000,
        }),
      });
      expect(a.decision).toBe(b.decision);
      expect(a.economics).toEqual(b.economics);
    });

    it("12. missing authoritative reward state → DO_NOT_USE", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: {
          reward_id: "r-missing",
        } as AuthoritativeLoyaltyRewardInput,
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("MISSING_AUTHORITATIVE_DATA");
    });

    it("13 / SCENARIO E — no invented points-to-money conversion", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: {
          reward_id: "r-points",
          authority: "BACKEND_DEFINED_LOYALTY_REWARD",
          source_reference: "backend:loyalty:points",
          value_kind: "POINTS_ONLY",
          points_balance: 100,
          validity: "VALID",
          eligibility: "ELIGIBLE",
          consumable: true,
        },
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("REWARD_VALUE_NOT_ESTABLISHED");
      expect(result.economics.immediate_benefit_minor).toBeNull();
      expect(result.economics.redeemable_value_minor).toBeNull();
      expect(result.economics.points_balance).toBe(100);
      // Never invent ₹10 from 100 points.
      expect(result.economics.hypothetical_amount_after_loyalty_minor).toBe(
        60_000,
      );
    });
  });

  describe("unknown future utility", () => {
    it("16. unknown future → conservative, no fabricated future, uncertainty exposed", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "r-unk",
          redeemable_value_minor: 10_000,
          future_use_value_minor: null,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.future_value_status).toBe("UNKNOWN");
      expect(result.economics.future_use_value_minor).toBeNull();
      expect(result.reasons).toContain("FUTURE_VALUE_UNCERTAIN");
      // No voucher 5% heuristic reused for loyalty (§10 has no such formula).
    });
  });

  describe("SCENARIO F — duplicate benefit / composition", () => {
    it("17. duplicate benefit with voucher → no double application", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket({
          gross_amount_minor: 100_000,
          realized_deal_benefit_minor: 0,
          voucher_benefit_minor: 10_000,
          effective_amount_before_loyalty_minor: 90_000,
          voucher_benefit_identity: "shared-x",
          voucher_source_reference: "backend:voucher:x",
        }),
        reward: reward({
          reward_id: "r-dup-v",
          benefit_identity: "shared-x",
          redeemable_value_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("DUPLICATE_BENEFIT");
      expect(result.economics.hypothetical_amount_after_loyalty_minor).toBe(
        90_000,
      );
    });

    it("18. duplicate benefit with merchant deal → no double application", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket({
          gross_amount_minor: 100_000,
          realized_deal_benefit_minor: 10_000,
          voucher_benefit_minor: 0,
          effective_amount_before_loyalty_minor: 90_000,
          merchant_deal_benefit_identity: "deal-x",
        }),
        reward: reward({
          reward_id: "r-dup-d",
          benefit_identity: "deal-x",
          redeemable_value_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("DUPLICATE_BENEFIT");
    });

    it("19. duplicate loyalty reward identity → no double application", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket({
          applied_loyalty_benefit_identities: ["loyalty-same"],
        }),
        reward: reward({
          reward_id: "r-dup-l",
          benefit_identity: "loyalty-same",
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("DUPLICATE_BENEFIT");
    });

    it("20. unauthorized reward stacking → no stacking", () => {
      const result = optimizeLoyaltyDecisions({
        basket: basket(),
        rewards: [
          reward({ reward_id: "r1", redeemable_value_minor: 4_000 }),
          reward({ reward_id: "r2", redeemable_value_minor: 9_000 }),
        ],
        stacking_authorized: true,
      });
      expect(result.stacking_applied).toBe(false);
      expect(result.selected?.reward_id).toBe("r2");
      expect(result.selected?.economics.immediate_benefit_minor).toBe(9_000);
      expect(result.selected?.economics.immediate_benefit_minor).not.toBe(
        13_000,
      );
    });

    it("independent deal + voucher + loyalty compose without double count", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket({
          gross_amount_minor: 100_000,
          realized_deal_benefit_minor: 10_000,
          voucher_benefit_minor: 10_000,
          effective_amount_before_loyalty_minor: 80_000,
          merchant_deal_source_reference: "backend:deal:a",
          voucher_source_reference: "backend:voucher:b",
        }),
        reward: reward({
          reward_id: "r-compose",
          source_reference: "backend:loyalty:c",
          benefit_identity: "loyalty-c",
          redeemable_value_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.economics.hypothetical_amount_after_loyalty_minor).toBe(
        70_000,
      );
    });
  });

  describe("hard constraints", () => {
    it("21. budget conflict → reward cannot repair invalid basket", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket({
          gross_amount_minor: 90_000,
          realized_deal_benefit_minor: 0,
          voucher_benefit_minor: 0,
          effective_amount_before_loyalty_minor: 90_000,
          budget_ceiling_minor: 80_000,
        }),
        reward: reward({
          reward_id: "r-budget",
          redeemable_value_minor: 20_000,
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("BUDGET_CONFLICT");
    });

    it("22–23. prior constraint / quality failure → DO_NOT_USE", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket({
          feasible: false,
          prior_rejection_reasons: ["OUT_OF_STOCK"],
          quality_signal: "UNACCEPTABLE",
        }),
        reward: reward({ reward_id: "r-prior" }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("PRIOR_CONSTRAINT_FAILED");
      expect(result.quality_signal).toBe("UNACCEPTABLE");
      expect(result.prior_feasible).toBe(false);
    });
  });

  describe("money and determinism", () => {
    it("24–25. integer paise only; no floating-point", () => {
      const resolved = resolveImmediateLoyaltyBenefit(60_000, 10_000);
      expect(Number.isInteger(resolved.immediate_benefit_minor)).toBe(true);
      expect(
        Number.isInteger(resolved.hypothetical_amount_after_loyalty_minor),
      ).toBe(true);

      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({ reward_id: "r-int" }),
      });
      expect(Number.isInteger(result.economics.immediate_benefit_minor)).toBe(
        true,
      );
    });

    it("caps redeemable so amount is never negative", () => {
      const resolved = resolveImmediateLoyaltyBenefit(5_000, 10_000);
      expect(resolved.immediate_benefit_minor).toBe(5_000);
      expect(resolved.hypothetical_amount_after_loyalty_minor).toBe(0);
    });

    it("26. deterministic output", () => {
      const input = {
        basket: basket(),
        reward: reward({ reward_id: "r-det" }),
      };
      expect(evaluateLoyaltyDecision(input)).toEqual(
        evaluateLoyaltyDecision(input),
      );
    });

    it("27. input-order independence for multiple rewards", () => {
      const rewards = [
        reward({ reward_id: "rz", redeemable_value_minor: 5_000 }),
        reward({ reward_id: "ra", redeemable_value_minor: 12_000 }),
        reward({ reward_id: "rm", redeemable_value_minor: 8_000 }),
      ];
      const forward = optimizeLoyaltyDecisions({
        basket: basket(),
        rewards,
      });
      const reverse = optimizeLoyaltyDecisions({
        basket: basket(),
        rewards: [...rewards].reverse(),
      });
      expect(forward.selected?.reward_id).toBe("ra");
      expect(reverse.selected?.reward_id).toBe("ra");
      expect(forward.selected).toEqual(reverse.selected);
      expect(forward.evaluations.map((e) => e.reward_id)).toEqual([
        "ra",
        "rm",
        "rz",
      ]);
    });
  });

  describe("metadata", () => {
    it("28. free-text reward description ignored", () => {
      const withDesc = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "r-ft",
          description: "Free points mega deal",
        }),
      });
      const without = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({ reward_id: "r-ft" }),
      });
      expect(withDesc.reasons).toEqual(without.reasons);
      expect(withDesc.economics).toEqual(without.economics);
    });

    it("29–30. reward ID/source and structured reason preserved", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "preserve-r",
          source_reference: "backend:loyalty:preserve",
          benefit_identity: "preserve-benefit",
        }),
      });
      expect(result.reward_id).toBe("preserve-r");
      expect(result.source_reference).toBe("backend:loyalty:preserve");
      expect(result.benefit_identity).toBe("preserve-benefit");
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(typeof result.reasons[0]).toBe("string");
    });

    it("31. no AI/LLM/network calls (pure function)", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({ reward_id: "r-pure" }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(typeof result).toBe("object");
    });

    it("not consumable → DO_NOT_USE", () => {
      const result = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({ reward_id: "r-nc", consumable: false }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("LOYALTY_NOT_CONSUMABLE");
    });

    it("selectLoyaltyDecision returns null for empty", () => {
      expect(selectLoyaltyDecision([] as LoyaltyDecisionResult[])).toBeNull();
    });

    it("selectLoyaltyDecision prefers USE_NOW over SAVE_FOR_LATER", () => {
      const useNow = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "use",
          redeemable_value_minor: 12_000,
          future_use_value_minor: 5_000,
        }),
      });
      const save = evaluateLoyaltyDecision({
        basket: basket(),
        reward: reward({
          reward_id: "save",
          redeemable_value_minor: 10_000,
          future_use_value_minor: 50_000,
        }),
      });
      expect(useNow.decision).toBe("USE_NOW");
      expect(save.decision).toBe("SAVE_FOR_LATER");
      const selected = selectLoyaltyDecision([save, useNow]);
      expect(selected?.reward_id).toBe("use");
    });
  });
});
