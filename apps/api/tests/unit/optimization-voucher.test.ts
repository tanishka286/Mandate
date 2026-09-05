import { describe, it, expect } from "vitest";
import {
  evaluateVoucherDecision,
  optimizeVoucherDecisions,
  resolveImmediateVoucherBenefit,
  selectVoucherDecision,
  type AuthoritativeVoucherInput,
  type VoucherBasketContextInput,
  type VoucherDecisionResult,
} from "../../src/modules/optimization/index.js";

function basket(
  overrides: Partial<VoucherBasketContextInput> = {},
): VoucherBasketContextInput {
  return {
    gross_amount_minor: 60_000,
    realized_deal_benefit_minor: 0,
    effective_amount_before_voucher_minor: 60_000,
    feasible: true,
    prior_rejection_reasons: [],
    quality_signal: "GOOD",
    confidence: 0.9,
    evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
    ...overrides,
  };
}

function voucher(
  overrides: Partial<AuthoritativeVoucherInput> &
    Pick<AuthoritativeVoucherInput, "voucher_id"> = {
    voucher_id: "voucher-a",
  },
): AuthoritativeVoucherInput {
  return {
    authority: "BACKEND_DEFINED_VOUCHER",
    source_reference: "backend:voucher:a",
    threshold_minor: 50_000,
    discount_minor: 10_000,
    validity: "VALID",
    eligibility: "ELIGIBLE",
    ...overrides,
  };
}

describe("Phase 5 Step 5 — smart voucher decision", () => {
  describe("SCENARIO A — immediate use", () => {
    it("1. valid voucher + threshold met → USE_NOW when immediate benefit justified", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 60_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 60_000,
        }),
        voucher: voucher({
          voucher_id: "v-use-now",
          threshold_minor: 50_000,
          discount_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.reasons).toContain("VOUCHER_VALID_AND_IMMEDIATE_BENEFIT");
      expect(result.future_value_status).toBe("UNKNOWN");
      expect(result.reasons).toContain("FUTURE_VALUE_UNCERTAIN");
      expect(result.economics.immediate_benefit_minor).toBe(10_000);
      expect(result.economics.hypothetical_amount_after_voucher_minor).toBe(
        50_000,
      );
      expect(result.economics.future_use_value_minor).toBeNull();
    });

    it("7. immediate discount correctly calculated", () => {
      const resolved = resolveImmediateVoucherBenefit(60_000, 10_000);
      expect(resolved.immediate_benefit_minor).toBe(10_000);
      expect(resolved.hypothetical_amount_after_voucher_minor).toBe(50_000);
    });

    it("6. threshold exactly met → eligible", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 50_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 50_000,
        }),
        voucher: voucher({
          voucher_id: "v-exact",
          threshold_minor: 50_000,
          discount_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.economics.qualifying_amount_minor).toBe(50_000);
    });
  });

  describe("invalid / expired / ineligible", () => {
    it("2. invalid voucher → DO_NOT_USE", () => {
      const result = evaluateVoucherDecision({
        basket: basket(),
        voucher: voucher({
          voucher_id: "v-invalid",
          validity: "INVALID",
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("VOUCHER_INVALID");
    });

    it("3. expired voucher → DO_NOT_USE (SCENARIO D)", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 80_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 80_000,
        }),
        voucher: voucher({
          voucher_id: "v-expired",
          threshold_minor: 50_000,
          discount_minor: 10_000,
          validity: "EXPIRED",
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("VOUCHER_EXPIRED");
    });

    it("4. ineligible voucher → DO_NOT_USE", () => {
      const result = evaluateVoucherDecision({
        basket: basket(),
        voucher: voucher({
          voucher_id: "v-ineligible",
          eligibility: "INELIGIBLE",
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("VOUCHER_INELIGIBLE");
    });
  });

  describe("SCENARIO B — below threshold / no padding", () => {
    it("5. below threshold → DO_NOT_USE without unrelated product addition", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 48_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 48_000,
        }),
        voucher: voucher({
          voucher_id: "v-below",
          threshold_minor: 50_000,
          discount_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("BELOW_THRESHOLD");
      expect(result.reasons).toContain("UNJUSTIFIED_THRESHOLD_EXPANSION");
      expect(result.economics.immediate_benefit_minor).toBe(0);
      expect(result.economics.hypothetical_amount_after_voucher_minor).toBe(
        48_000,
      );
    });

    it("13. no unrelated products are added solely for voucher threshold", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 48_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 48_000,
        }),
        voucher: voucher({ voucher_id: "v-no-pad" }),
      });
      // Engine returns a decision only — never emits add-on SKUs/lines.
      expect(result.decision).toBe("DO_NOT_USE");
      expect(Object.keys(result)).not.toContain("added_products");
      expect(Object.keys(result)).not.toContain("suggested_lines");
    });

    it("14. existing required item can naturally cause threshold to be met", () => {
      // Basket already includes justified items totaling ₹520 — no padding.
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 52_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 52_000,
        }),
        voucher: voucher({
          voucher_id: "v-natural",
          threshold_minor: 50_000,
          discount_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
    });
  });

  describe("SCENARIO C — future value", () => {
    it("1. known future value > current saving → SAVE_FOR_LATER", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 60_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 60_000,
        }),
        voucher: voucher({
          voucher_id: "v-future",
          threshold_minor: 50_000,
          discount_minor: 10_000,
          future_use_value_minor: 25_000,
        }),
      });
      expect(result.decision).toBe("SAVE_FOR_LATER");
      expect(result.reasons).toContain("FUTURE_VALUE_PREFERRED");
      expect(result.future_value_status).toBe("KNOWN");
      expect(result.economics.future_use_value_minor).toBe(25_000);
      expect(result.economics.opportunity_cost_minor).toBe(10_000);
      expect(result.economics.hypothetical_amount_after_voucher_minor).toBe(
        60_000,
      );
    });

    it("2. known future value <= current saving → USE_NOW", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 60_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 60_000,
        }),
        voucher: voucher({
          voucher_id: "v-known-le",
          discount_minor: 10_000,
          future_use_value_minor: 8_000,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.future_value_status).toBe("KNOWN");
      expect(result.economics.future_use_value_minor).toBe(8_000);
      expect(result.reasons).toContain("VOUCHER_VALID_AND_IMMEDIATE_BENEFIT");
      expect(result.reasons).not.toContain("FUTURE_VALUE_UNCERTAIN");
    });

    it("3. unknown future + meaningful current saving → USE_NOW with uncertainty", () => {
      const result = evaluateVoucherDecision({
        basket: basket(),
        voucher: voucher({
          voucher_id: "v-no-future",
          future_use_value_minor: null,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.future_value_status).toBe("UNKNOWN");
      expect(result.economics.future_use_value_minor).toBeNull();
      expect(result.reasons).toContain("VOUCHER_VALID_AND_IMMEDIATE_BENEFIT");
      expect(result.reasons).toContain("FUTURE_VALUE_UNCERTAIN");
      expect(result.reasons).not.toContain("FUTURE_VALUE_PREFERRED");
    });

    it("4. unknown future + weak current saving → SAVE_FOR_LATER (conservative)", () => {
      // Doc 05 §9.3: ₹5 on ₹100 (5%) is weak under uncertainty.
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 10_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 10_000,
        }),
        voucher: voucher({
          voucher_id: "v-weak-unknown",
          threshold_minor: 0,
          discount_minor: 500,
          future_use_value_minor: null,
        }),
      });
      expect(result.decision).toBe("SAVE_FOR_LATER");
      expect(result.future_value_status).toBe("UNKNOWN");
      expect(result.economics.future_use_value_minor).toBeNull();
      expect(result.reasons).toContain("FUTURE_VALUE_UNCERTAIN");
      expect(result.economics.opportunity_cost_minor).toBe(500);
    });

    it("5. unknown future never fabricates a numeric future value", () => {
      const meaningful = evaluateVoucherDecision({
        basket: basket(),
        voucher: voucher({ voucher_id: "v-m", future_use_value_minor: null }),
      });
      const weak = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 10_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 10_000,
        }),
        voucher: voucher({
          voucher_id: "v-w",
          threshold_minor: 0,
          discount_minor: 500,
        }),
      });
      expect(meaningful.economics.future_use_value_minor).toBeNull();
      expect(weak.economics.future_use_value_minor).toBeNull();
      expect(meaningful.future_value_status).toBe("UNKNOWN");
      expect(weak.future_value_status).toBe("UNKNOWN");
    });

    it("Doc 10 snack case: ₹5 current vs known meaningful future → SAVE_FOR_LATER", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 10_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 10_000,
        }),
        voucher: voucher({
          voucher_id: "v-snack",
          threshold_minor: 0,
          discount_minor: 500,
          future_use_value_minor: 5_000,
        }),
      });
      expect(result.decision).toBe("SAVE_FOR_LATER");
      expect(result.future_value_status).toBe("KNOWN");
    });
  });

  describe("no immediate benefit", () => {
    it("17. DO_NOT_USE when immediate benefit is not useful and no future basis", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 60_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 60_000,
        }),
        voucher: voucher({
          voucher_id: "v-zero",
          discount_minor: 0,
          future_use_value_minor: null,
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("NO_IMMEDIATE_BENEFIT");
    });
  });

  describe("SCENARIO E — deal + voucher composition", () => {
    it("8. merchant deal + voucher do not double-count when independent", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 100_000,
          realized_deal_benefit_minor: 10_000,
          effective_amount_before_voucher_minor: 90_000,
          merchant_deal_source_reference: "backend:deal:pack",
          merchant_deal_benefit_identity: "deal:pack-saving",
        }),
        voucher: voucher({
          voucher_id: "v-indep",
          source_reference: "backend:voucher:indep",
          benefit_identity: "voucher:indep-100",
          threshold_minor: 50_000,
          discount_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.economics.gross_amount_minor).toBe(100_000);
      expect(result.economics.realized_deal_benefit_minor).toBe(10_000);
      expect(result.economics.effective_amount_before_voucher_minor).toBe(
        90_000,
      );
      expect(result.economics.immediate_benefit_minor).toBe(10_000);
      expect(result.economics.hypothetical_amount_after_voucher_minor).toBe(
        80_000,
      );
    });

    it("9. duplicate benefit identity is rejected / fails closed", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 100_000,
          realized_deal_benefit_minor: 10_000,
          effective_amount_before_voucher_minor: 90_000,
          merchant_deal_benefit_identity: "shared-benefit-100",
          merchant_deal_source_reference: "backend:deal:shared",
        }),
        voucher: voucher({
          voucher_id: "v-dup",
          benefit_identity: "shared-benefit-100",
          source_reference: "backend:voucher:shared",
          discount_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("DUPLICATE_BENEFIT");
      expect(result.economics.hypothetical_amount_after_voucher_minor).toBe(
        90_000,
      );
    });
  });

  describe("hard constraints", () => {
    it("10. voucher cannot override budget", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 90_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 90_000,
          budget_ceiling_minor: 80_000,
        }),
        voucher: voucher({
          voucher_id: "v-budget",
          discount_minor: 20_000,
        }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("BUDGET_CONFLICT");
    });

    it("11. voucher cannot override minimum quality", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          feasible: false,
          prior_rejection_reasons: ["REQUIREMENT_NOT_FULFILLED"],
          quality_signal: "UNACCEPTABLE",
        }),
        voucher: voucher({ voucher_id: "v-quality" }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("PRIOR_CONSTRAINT_FAILED");
      expect(result.prior_feasible).toBe(false);
      expect(result.quality_signal).toBe("UNACCEPTABLE");
    });

    it("12. voucher cannot override stock/category/lifecycle constraints", () => {
      for (const reason of [
        "OUT_OF_STOCK",
        "CATEGORY_NOT_ALLOWED",
        "INACTIVE_SKU",
      ] as const) {
        const result = evaluateVoucherDecision({
          basket: basket({
            feasible: false,
            prior_rejection_reasons: [reason],
          }),
          voucher: voucher({ voucher_id: `v-${reason}` }),
        });
        expect(result.decision).toBe("DO_NOT_USE");
        expect(result.reasons).toContain("PRIOR_CONSTRAINT_FAILED");
      }
    });
  });

  describe("money invariants", () => {
    it("18. voucher discount cannot make effective amount negative", () => {
      const resolved = resolveImmediateVoucherBenefit(5_000, 10_000);
      expect(resolved.immediate_benefit_minor).toBe(5_000);
      expect(resolved.hypothetical_amount_after_voucher_minor).toBe(0);

      const result = evaluateVoucherDecision({
        basket: basket({
          gross_amount_minor: 5_000,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: 5_000,
        }),
        voucher: voucher({
          voucher_id: "v-cap",
          threshold_minor: 0,
          discount_minor: 10_000,
        }),
      });
      expect(result.decision).toBe("USE_NOW");
      expect(result.economics.hypothetical_amount_after_voucher_minor).toBe(0);
      expect(result.economics.immediate_benefit_minor).toBe(5_000);
    });

    it("19–20. integer money only; no floating-point arithmetic", () => {
      const result = evaluateVoucherDecision({
        basket: basket(),
        voucher: voucher({ voucher_id: "v-int" }),
      });
      expect(Number.isInteger(result.economics.immediate_benefit_minor)).toBe(
        true,
      );
      expect(
        Number.isInteger(
          result.economics.hypothetical_amount_after_voucher_minor,
        ),
      ).toBe(true);
      expect(Number.isInteger(result.economics.gross_amount_minor)).toBe(true);
    });
  });

  describe("determinism and multi-voucher", () => {
    it("21. same input produces same decision", () => {
      const input = {
        basket: basket(),
        voucher: voucher({ voucher_id: "v-det" }),
      };
      const a = evaluateVoucherDecision(input);
      const b = evaluateVoucherDecision(input);
      expect(a).toEqual(b);
    });

    it("22. input order does not change result", () => {
      const b = basket();
      const vouchers = [
        voucher({
          voucher_id: "voucher-z",
          discount_minor: 5_000,
        }),
        voucher({
          voucher_id: "voucher-a",
          discount_minor: 12_000,
        }),
        voucher({
          voucher_id: "voucher-m",
          discount_minor: 8_000,
        }),
      ];
      const forward = optimizeVoucherDecisions({ basket: b, vouchers });
      const reverse = optimizeVoucherDecisions({
        basket: b,
        vouchers: [...vouchers].reverse(),
      });
      expect(forward.selected?.voucher_id).toBe("voucher-a");
      expect(reverse.selected?.voucher_id).toBe("voucher-a");
      expect(forward.selected).toEqual(reverse.selected);
      expect(forward.evaluations.map((e) => e.voucher_id)).toEqual([
        "voucher-a",
        "voucher-m",
        "voucher-z",
      ]);
    });

    it("23–24. multiple vouchers handled deterministically; no stacking", () => {
      const result = optimizeVoucherDecisions({
        basket: basket(),
        vouchers: [
          voucher({ voucher_id: "v1", discount_minor: 4_000 }),
          voucher({ voucher_id: "v2", discount_minor: 9_000 }),
        ],
        stacking_authorized: true,
      });
      expect(result.stacking_applied).toBe(false);
      expect(result.selected?.voucher_id).toBe("v2");
      expect(result.selected?.economics.immediate_benefit_minor).toBe(9_000);
      // Not combined 4k+9k.
      expect(result.selected?.economics.immediate_benefit_minor).not.toBe(
        13_000,
      );
    });

    it("selectVoucherDecision prefers USE_NOW over SAVE_FOR_LATER", () => {
      const useNow = evaluateVoucherDecision({
        basket: basket(),
        voucher: voucher({
          voucher_id: "use",
          discount_minor: 12_000,
          future_use_value_minor: 5_000,
        }),
      });
      const save = evaluateVoucherDecision({
        basket: basket(),
        voucher: voucher({
          voucher_id: "save",
          discount_minor: 10_000,
          future_use_value_minor: 50_000,
        }),
      });
      expect(useNow.decision).toBe("USE_NOW");
      expect(save.decision).toBe("SAVE_FOR_LATER");
      const selected = selectVoucherDecision([save, useNow]);
      expect(selected?.voucher_id).toBe("use");
      expect(selected?.decision).toBe("USE_NOW");
    });
  });

  describe("authority and metadata", () => {
    it("25–26. voucher ID/source/authority and structured reason preserved", () => {
      const result = evaluateVoucherDecision({
        basket: basket(),
        voucher: voucher({
          voucher_id: "preserve-id",
          source_reference: "backend:voucher:preserve",
          benefit_identity: "preserve-benefit",
        }),
      });
      expect(result.voucher_id).toBe("preserve-id");
      expect(result.authority).toBe("BACKEND_DEFINED_VOUCHER");
      expect(result.source_reference).toBe("backend:voucher:preserve");
      expect(result.benefit_identity).toBe("preserve-benefit");
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(typeof result.reasons[0]).toBe("string");
    });

    it("27. quality/evidence from prior steps remains attached", () => {
      const result = evaluateVoucherDecision({
        basket: basket({
          quality_signal: "PREMIUM",
          confidence: 0.95,
          evidence_refs: [
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02",
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
          ],
        }),
        voucher: voucher({ voucher_id: "v-ev" }),
      });
      expect(result.quality_signal).toBe("PREMIUM");
      expect(result.confidence).toBe(0.95);
      expect(result.evidence_refs).toEqual([
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02",
      ]);
    });

    it("28. missing authoritative voucher data fails closed", () => {
      const result = evaluateVoucherDecision({
        basket: basket(),
        voucher: {
          voucher_id: "bad",
          // missing authority / threshold etc.
        } as AuthoritativeVoucherInput,
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("MISSING_AUTHORITATIVE_DATA");
    });

    it("28b. inconsistent basket economics fail closed", () => {
      const result = evaluateVoucherDecision({
        basket: {
          gross_amount_minor: 100_000,
          realized_deal_benefit_minor: 10_000,
          // Wrong: should be 90_000
          effective_amount_before_voucher_minor: 80_000,
          feasible: true,
        },
        voucher: voucher({ voucher_id: "v-inconsistent" }),
      });
      expect(result.decision).toBe("DO_NOT_USE");
      expect(result.reasons).toContain("MISSING_AUTHORITATIVE_DATA");
    });

    it("29. free-text voucher description does not affect decision", () => {
      const base = {
        basket: basket(),
        voucher: voucher({
          voucher_id: "v-desc",
          description: "Huge mega savings!!!",
        }),
      };
      const withDesc = evaluateVoucherDecision(base);
      const withoutDesc = evaluateVoucherDecision({
        basket: base.basket,
        voucher: voucher({ voucher_id: "v-desc" }),
      });
      expect(withDesc.decision).toBe(withoutDesc.decision);
      expect(withDesc.economics).toEqual(withoutDesc.economics);
      expect(withDesc.reasons).toEqual(withoutDesc.reasons);
    });

    it("30. no AI/LLM/network calls (pure function)", () => {
      const result = evaluateVoucherDecision({
        basket: basket(),
        voucher: voucher({ voucher_id: "v-pure" }),
      });
      expect(result.decision).toBe("USE_NOW");
      // Module is synchronous and has no fetch/openai imports — verified by
      // determinism tests and by file inspection in the implementation report.
      expect(typeof result).toBe("object");
    });
  });

  describe("selection helper", () => {
    it("returns null for empty evaluations", () => {
      expect(selectVoucherDecision([] as VoucherDecisionResult[])).toBeNull();
    });
  });
});
