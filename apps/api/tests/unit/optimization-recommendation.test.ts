import { describe, it, expect } from "vitest";
import {
  recommendBasket,
  deriveBasketId,
  RECOMMENDATION_REASON_CODES,
  RECOMMENDATION_DECISION_CLARITY,
  type BestValueBasket,
  type BestQualityBasket,
  type BestValueIncentiveSummary,
  type BasketRecommendationResult,
} from "../../src/modules/optimization/index.js";
import {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
} from "../../src/modules/research/seed-fixtures.js";

const EVIDENCE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";

function emptyIncentive(
  overrides: Partial<BestValueIncentiveSummary> = {},
): BestValueIncentiveSummary {
  return {
    voucher_decision: null,
    voucher_id: null,
    voucher_benefit_minor: 0,
    loyalty_decision: null,
    reward_id: null,
    loyalty_benefit_minor: 0,
    realized_deal_benefit_minor: 0,
    ...overrides,
  };
}

function baseItem(overrides: Partial<BestValueBasket["items"][number]> = {}) {
  return {
    requirement_key: "eggs",
    requirement_id: null,
    item_name: "eggs",
    sku_id: SEED_SKU_IDS.farmEggs6,
    product_id: SEED_PRODUCT_IDS.farmEggs,
    sku_code: "EGGS-6",
    quantity: 1,
    unit_price_minor: 65000,
    line_amount_minor: 65000,
    quality_signal: "GOOD" as const,
    confidence: 0.9,
    evidence_refs: [EVIDENCE],
    ...overrides,
  };
}

function bestValueBasket(
  overrides: Partial<BestValueBasket> & {
    practical_cost_minor?: number;
    gross_amount_minor?: number;
    discount_amount_minor?: number;
  } = {},
): BestValueBasket {
  const {
    explanation: explanationOverride,
    items: itemsOverride,
    quality_signal: qualityOverride,
    confidence: confidenceOverride,
    evidence_refs: evidenceOverride,
    excess_quantity_total: excessOverride,
    combination_key: comboOverride,
    currency: currencyOverride,
    gross_amount_minor: _g,
    discount_amount_minor: _d,
    practical_cost_minor: _p,
    amount_kind: _ak,
    basket_type: _bt,
    ...ignored
  } = overrides;
  void ignored;
  const gross = overrides.gross_amount_minor ?? 65000;
  const discount = overrides.discount_amount_minor ?? 0;
  const practical = overrides.practical_cost_minor ?? gross - discount;
  return {
    basket_type: "BEST_VALUE",
    currency: currencyOverride ?? "INR",
    items:
      itemsOverride ?? [
        baseItem({ line_amount_minor: gross, unit_price_minor: gross }),
      ],
    gross_amount_minor: gross,
    discount_amount_minor: discount,
    practical_cost_minor: practical,
    amount_kind: "PRACTICAL_OPTIMIZATION_COST",
    quality_signal: qualityOverride ?? "GOOD",
    confidence: confidenceOverride ?? 0.9,
    evidence_refs: evidenceOverride ?? [EVIDENCE],
    excess_quantity_total: excessOverride ?? 0,
    combination_key: comboOverride ?? "bv-combo-001",
    explanation: {
      objective: "BEST_VALUE",
      reasons: ["REQUIREMENTS_FULFILLED", "LOWEST_PRACTICAL_COST"],
      quality_floor: "ACCEPTABLE",
      excess_quantity_total: excessOverride ?? 0,
      incentive: emptyIncentive(),
      ...explanationOverride,
    },
  };
}

function bestQualityBasket(
  overrides: Partial<BestQualityBasket> & {
    practical_cost_minor?: number;
    gross_amount_minor?: number;
    discount_amount_minor?: number;
  } = {},
): BestQualityBasket {
  const {
    explanation: explanationOverride,
    items: itemsOverride,
    quality_signal: qualityOverride,
    confidence: confidenceOverride,
    evidence_refs: evidenceOverride,
    excess_quantity_total: excessOverride,
    combination_key: comboOverride,
    currency: currencyOverride,
    gross_amount_minor: _g,
    discount_amount_minor: _d,
    practical_cost_minor: _p,
    amount_kind: _ak,
    basket_type: _bt,
    ...ignored
  } = overrides;
  void ignored;
  const gross = overrides.gross_amount_minor ?? 82000;
  const discount = overrides.discount_amount_minor ?? 0;
  const practical = overrides.practical_cost_minor ?? gross - discount;
  return {
    basket_type: "BEST_QUALITY",
    currency: currencyOverride ?? "INR",
    items:
      itemsOverride ?? [
        baseItem({
          sku_id: SEED_SKU_IDS.selectEggs6,
          product_id: SEED_PRODUCT_IDS.selectEggs,
          sku_code: "EGGS-SELECT-6",
          line_amount_minor: gross,
          unit_price_minor: gross,
          quality_signal: qualityOverride ?? "PREMIUM",
        }),
      ],
    gross_amount_minor: gross,
    discount_amount_minor: discount,
    practical_cost_minor: practical,
    amount_kind: "PRACTICAL_OPTIMIZATION_COST",
    quality_signal: qualityOverride ?? "PREMIUM",
    confidence: confidenceOverride ?? 0.95,
    evidence_refs: evidenceOverride ?? [EVIDENCE],
    excess_quantity_total: excessOverride ?? 0,
    combination_key: comboOverride ?? "bq-combo-001",
    explanation: {
      objective: "BEST_QUALITY",
      reasons: ["REQUIREMENTS_FULFILLED", "HIGHEST_PRACTICAL_QUALITY"],
      quality_floor: "ACCEPTABLE",
      excess_quantity_total: excessOverride ?? 0,
      incentive: emptyIncentive(),
      ...explanationOverride,
    },
  };
}

function assertBoundaryFlags(result: BasketRecommendationResult) {
  expect(result.selection_created).toBe(false);
  expect(result.quote_created).toBe(false);
  expect(result.policy_decision).toBeNull();
  expect(result.payment_created).toBe(false);
  expect(result.user_may_select_alternative).toBe(true);
  expect(result.tradeoff.amount_kind).toBe("PRACTICAL_OPTIMIZATION_COST");
  const json = JSON.stringify(result);
  expect(json).not.toContain("final_payable_minor");
  expect(json).not.toMatch(/"ALLOW"|"DENY"/);
  expect(Object.keys(result)).not.toContain("quote");
  expect(Object.keys(result)).not.toContain("order");
  expect(Object.keys(result)).not.toContain("razorpay");
}

describe("Phase 5 Step 9 — Basket comparison + recommendation metadata", () => {
  it("TEST 1 — Material quality advantage → Best Quality", () => {
    const bv = bestValueBasket({
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
    });
    const bq = bestQualityBasket({
      practical_cost_minor: 82000,
      gross_amount_minor: 82000,
      quality_signal: "PREMIUM",
    });
    const result = recommendBasket({
      best_value: bv,
      best_quality: bq,
      best_value_basket_id: "basket-value-001",
      best_quality_basket_id: "basket-quality-001",
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_type).toBe("BEST_QUALITY");
    expect(result.recommended_basket_id).toBe("basket-quality-001");
    expect(result.reason_code).toBe("MATERIAL_QUALITY_ADVANTAGE");
    expect(result.tradeoff.material_quality_difference).toBe(true);
    expect(result.alternative_basket_id).toBe("basket-value-001");
  });

  it("TEST 2 — Best Value cost advantage with acceptable quality", () => {
    const bv = bestValueBasket({
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
    });
    // Same quality rank, higher cost → additional quality cost not justified
    const bq = bestQualityBasket({
      practical_cost_minor: 69000,
      gross_amount_minor: 69000,
      quality_signal: "GOOD",
    });
    const result = recommendBasket({ best_value: bv, best_quality: bq });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_type).toBe("BEST_VALUE");
    expect(result.reason_code).toBe("IMMATERIAL_QUALITY_DIFFERENCE");
  });

  it("TEST 3 — Explicit quality preference → Best Quality", () => {
    const bv = bestValueBasket({ quality_signal: "GOOD" });
    const bq = bestQualityBasket({
      practical_cost_minor: 82000,
      gross_amount_minor: 82000,
      quality_signal: "PREMIUM",
    });
    const result = recommendBasket({
      best_value: bv,
      best_quality: bq,
      explicit_preference: "BEST_QUALITY",
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_type).toBe("BEST_QUALITY");
    expect(result.reason_code).toBe("QUALITY_PREFERENCE_ALIGNED");
    expect(result.preference_applied).toBe("BEST_QUALITY");
  });

  it("TEST 4 — Explicit cost preference → Best Value", () => {
    const bv = bestValueBasket({ quality_signal: "GOOD" });
    const bq = bestQualityBasket({
      practical_cost_minor: 82000,
      gross_amount_minor: 82000,
      quality_signal: "PREMIUM",
    });
    const result = recommendBasket({
      best_value: bv,
      best_quality: bq,
      explicit_preference: "BEST_VALUE",
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_type).toBe("BEST_VALUE");
    expect(result.reason_code).toBe("COST_PREFERENCE_ALIGNED");
    expect(result.preference_applied).toBe("BEST_VALUE");
  });

  it("TEST 5 — Immaterial quality difference → Best Value", () => {
    const bv = bestValueBasket({
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
    });
    const bq = bestQualityBasket({
      practical_cost_minor: 69000,
      gross_amount_minor: 69000,
      quality_signal: "GOOD",
    });
    const result = recommendBasket({ best_value: bv, best_quality: bq });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_type).toBe("BEST_VALUE");
    expect(result.reason_code).toBe("IMMATERIAL_QUALITY_DIFFERENCE");
    expect(result.tradeoff.material_quality_difference).toBe(false);
  });

  it("TEST 6 — Preference-dependent trade-off", () => {
    const bv = bestValueBasket({
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
    });
    const bq = bestQualityBasket({
      practical_cost_minor: 82000,
      gross_amount_minor: 82000,
      quality_signal: "PREMIUM",
    });

    const withQuality = recommendBasket({
      best_value: bv,
      best_quality: bq,
      explicit_preference: "BEST_QUALITY",
    });
    const withCost = recommendBasket({
      best_value: bv,
      best_quality: bq,
      explicit_preference: "BEST_VALUE",
    });
    const without = recommendBasket({
      best_value: bv,
      best_quality: bq,
      explicit_preference: "NONE",
    });

    expect(withQuality.feasible && withCost.feasible && without.feasible).toBe(
      true,
    );
    if (!withQuality.feasible || !withCost.feasible || !without.feasible) {
      return;
    }
    expect(withQuality.recommended_basket_type).toBe("BEST_QUALITY");
    expect(withCost.recommended_basket_type).toBe("BEST_VALUE");
    // Without preference: material quality still recommends BQ, but trade-off exposed
    expect(without.recommended_basket_type).toBe("BEST_QUALITY");
    expect(without.reason_codes).toContain("TRADEOFF_PREFERENCE_DEPENDENT");
    expect(without.alternative_basket_id).not.toBeNull();
  });

  it("TEST 7 — Excess difference is not requirement-satisfaction advantage", () => {
    const bv = bestValueBasket({
      excess_quantity_total: 4,
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
      explanation: {
        objective: "BEST_VALUE",
        reasons: ["REQUIREMENTS_FULFILLED"],
        quality_floor: "ACCEPTABLE",
        excess_quantity_total: 4,
        incentive: emptyIncentive(),
      },
    });
    const bq = bestQualityBasket({
      excess_quantity_total: 0,
      practical_cost_minor: 70000,
      gross_amount_minor: 70000,
      quality_signal: "GOOD",
      explanation: {
        objective: "BEST_QUALITY",
        reasons: ["REQUIREMENTS_FULFILLED"],
        quality_floor: "ACCEPTABLE",
        excess_quantity_total: 0,
        incentive: emptyIncentive(),
      },
    });
    const result = recommendBasket({ best_value: bv, best_quality: bq });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    // Same requirement coverage + same quality → Best Value on immaterial cost, not RSA
    expect(result.reason_code).not.toBe("REQUIREMENT_SATISFACTION_ADVANTAGE");
    expect(result.reason_codes).not.toContain("REQUIREMENT_SATISFACTION_ADVANTAGE");
    expect(result.recommended_basket_type).toBe("BEST_VALUE");
    expect(result.reason_code).toBe("IMMATERIAL_QUALITY_DIFFERENCE");
    expect(result.tradeoff.excess_quantity_best_value).toBe(4);
    expect(result.tradeoff.excess_quantity_best_quality).toBe(0);
  });

  it("CORRECTION 1 — Different excess with equivalent requirement coverage", () => {
    const bv = bestValueBasket({
      excess_quantity_total: 0,
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
    });
    const bq = bestQualityBasket({
      excess_quantity_total: 6,
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
    });
    const result = recommendBasket({ best_value: bv, best_quality: bq });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.reason_code).not.toBe("REQUIREMENT_SATISFACTION_ADVANTAGE");
    expect(result.tradeoff.excess_quantity_best_value).toBe(0);
    expect(result.tradeoff.excess_quantity_best_quality).toBe(6);
  });

  it("CORRECTION 2 — Lower excess does not override material quality advantage", () => {
    const bv = bestValueBasket({
      excess_quantity_total: 0,
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
    });
    const bq = bestQualityBasket({
      excess_quantity_total: 4,
      practical_cost_minor: 82000,
      gross_amount_minor: 82000,
      quality_signal: "PREMIUM",
    });
    const result = recommendBasket({ best_value: bv, best_quality: bq });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_type).toBe("BEST_QUALITY");
    expect(result.reason_code).toBe("MATERIAL_QUALITY_ADVANTAGE");
    expect(result.reason_codes).not.toContain("REQUIREMENT_SATISFACTION_ADVANTAGE");
  });

  it("CORRECTION 3 — Genuine structured requirement coverage difference", () => {
    const bv = bestValueBasket({
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
      items: [
        baseItem({
          requirement_key: "eggs",
          line_amount_minor: 40000,
          unit_price_minor: 40000,
        }),
      ],
    });
    const bq = bestQualityBasket({
      practical_cost_minor: 90000,
      gross_amount_minor: 90000,
      quality_signal: "GOOD",
      items: [
        baseItem({
          requirement_key: "eggs",
          sku_id: SEED_SKU_IDS.selectEggs6,
          product_id: SEED_PRODUCT_IDS.selectEggs,
          line_amount_minor: 50000,
          unit_price_minor: 50000,
          quality_signal: "GOOD",
        }),
        baseItem({
          requirement_key: "milk",
          item_name: "milk",
          sku_id: SEED_SKU_IDS.freshMilk1l,
          product_id: SEED_PRODUCT_IDS.freshMilk,
          sku_code: "MILK-1L",
          line_amount_minor: 40000,
          unit_price_minor: 40000,
          quality_signal: "GOOD",
        }),
      ],
    });
    const result = recommendBasket({ best_value: bv, best_quality: bq });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_type).toBe("BEST_QUALITY");
    expect(result.reason_code).toBe("REQUIREMENT_SATISFACTION_ADVANTAGE");
  });

  it("CORRECTION 4 — No arbitrary comfortably-within-budget percentage", () => {
    const result = recommendBasket({
      best_value: bestValueBasket(),
      best_quality: bestQualityBasket(),
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/0\.(1|2|3)\b.*budget|budget.*0\.(1|2|3)/i);
    expect(json).not.toContain("comfortably_within");
    expect(json).not.toContain("budget_headroom_pct");
    expect(json).not.toContain("mandate_margin_pct");
    expect(Object.keys(result.tradeoff)).not.toContain("budget_utilization_pct");
  });

  it("TEST 8 — SAVE_FOR_LATER is not counted as current saving", () => {
    const bv = bestValueBasket({
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
      explanation: {
        objective: "BEST_VALUE",
        reasons: ["INCENTIVE_PRESERVED"],
        quality_floor: "ACCEPTABLE",
        excess_quantity_total: 0,
        incentive: emptyIncentive({
          voucher_decision: "SAVE_FOR_LATER",
          voucher_id: "voucher-001",
          voucher_benefit_minor: 5000,
        }),
      },
    });
    const bq = bestQualityBasket({
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
      explanation: {
        objective: "BEST_QUALITY",
        reasons: ["REQUIREMENTS_FULFILLED"],
        quality_floor: "ACCEPTABLE",
        excess_quantity_total: 0,
        incentive: emptyIncentive({
          voucher_decision: "USE_NOW",
          voucher_id: "voucher-002",
          voucher_benefit_minor: 100,
        }),
      },
    });
    const result = recommendBasket({ best_value: bv, best_quality: bq });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.tradeoff.incentive_best_value?.current_incentive_benefit_minor).toBe(
      0,
    );
    expect(
      result.tradeoff.incentive_best_value?.preserves_future_opportunity,
    ).toBe(true);
    expect(
      result.tradeoff.incentive_best_quality?.current_incentive_benefit_minor,
    ).toBe(100);
  });

  it("TEST 9 — DO_NOT_USE confers no current recommendation benefit", () => {
    const bv = bestValueBasket({
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
      explanation: {
        objective: "BEST_VALUE",
        reasons: ["REQUIREMENTS_FULFILLED"],
        quality_floor: "ACCEPTABLE",
        excess_quantity_total: 0,
        incentive: emptyIncentive({
          voucher_decision: "DO_NOT_USE",
          voucher_id: "voucher-x",
          voucher_benefit_minor: 8000,
        }),
      },
    });
    const bq = bestQualityBasket({
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
      quality_signal: "GOOD",
    });
    const result = recommendBasket({ best_value: bv, best_quality: bq });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.tradeoff.incentive_best_value?.current_incentive_benefit_minor).toBe(
      0,
    );
    expect(
      result.tradeoff.incentive_best_value?.preserves_future_opportunity,
    ).toBe(false);
  });

  it("TEST 10 — Only Best Value", () => {
    const bv = bestValueBasket();
    const result = recommendBasket({
      best_value: bv,
      best_quality: null,
      best_value_basket_id: "basket-value-only",
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_type).toBe("BEST_VALUE");
    expect(result.recommended_basket_id).toBe("basket-value-only");
    expect(result.alternative_basket_id).toBeNull();
    expect(result.alternative_basket_type).toBeNull();
    expect(result.reason_codes).toContain("ALTERNATIVE_UNAVAILABLE");
  });

  it("TEST 11 — Only Best Quality", () => {
    const bq = bestQualityBasket();
    const result = recommendBasket({
      best_value: null,
      best_quality: bq,
      best_quality_basket_id: "basket-quality-only",
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_type).toBe("BEST_QUALITY");
    expect(result.recommended_basket_id).toBe("basket-quality-only");
    expect(result.alternative_basket_id).toBeNull();
    expect(result.reason_codes).toContain("ALTERNATIVE_UNAVAILABLE");
  });

  it("TEST 12 — No baskets → structured failure", () => {
    const result = recommendBasket({
      best_value: null,
      best_quality: null,
    });
    expect(result.feasible).toBe(false);
    if (result.feasible) return;
    expect(result.reason_code).toBe("NO_FEASIBLE_BASKETS");
    expect(result.recommended_basket_id).toBeNull();
    expect(result.alternative_basket_id).toBeNull();
    assertBoundaryFlags(result);
  });

  it("TEST 13 — Alternative preserved when both exist", () => {
    const bv = bestValueBasket();
    const bq = bestQualityBasket();
    const result = recommendBasket({
      best_value: bv,
      best_quality: bq,
      best_value_basket_id: "basket-value-001",
      best_quality_basket_id: "basket-quality-001",
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.recommended_basket_id).toBeTruthy();
    expect(result.alternative_basket_id).toBeTruthy();
    expect(result.recommended_basket_id).not.toBe(result.alternative_basket_id);
    const ids = new Set([
      result.recommended_basket_id,
      result.alternative_basket_id,
    ]);
    expect(ids.has("basket-value-001")).toBe(true);
    expect(ids.has("basket-quality-001")).toBe(true);
  });

  it("TEST 14 — User override boundary (no selection created)", () => {
    const result = recommendBasket({
      best_value: bestValueBasket(),
      best_quality: bestQualityBasket(),
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.selection_created).toBe(false);
    expect(result.user_may_select_alternative).toBe(true);
    expect(Object.keys(result)).not.toContain("selected_basket_id");
    expect(Object.keys(result)).not.toContain("user_selection");
  });

  it("TEST 15 — No quote created", () => {
    const result = recommendBasket({
      best_value: bestValueBasket(),
      best_quality: bestQualityBasket(),
    });
    expect(result.quote_created).toBe(false);
    expect(Object.keys(result)).not.toContain("quote_id");
    expect(JSON.stringify(result)).not.toContain("final_payable_minor");
  });

  it("TEST 16 — No policy ALLOW/DENY", () => {
    const result = recommendBasket({
      best_value: bestValueBasket(),
      best_quality: bestQualityBasket(),
    });
    expect(result.policy_decision).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/"ALLOW"|"DENY"/);
  });

  it("TEST 17 — No payment / order state", () => {
    const result = recommendBasket({
      best_value: bestValueBasket(),
      best_quality: bestQualityBasket(),
    });
    expect(result.payment_created).toBe(false);
    expect(Object.keys(result)).not.toContain("payment_id");
    expect(Object.keys(result)).not.toContain("order_id");
    expect(JSON.stringify(result)).not.toContain("razorpay");
  });

  it("TEST 18 — Practical-cost boundary", () => {
    const result = recommendBasket({
      best_value: bestValueBasket({ practical_cost_minor: 65000, gross_amount_minor: 65000 }),
      best_quality: bestQualityBasket({
        practical_cost_minor: 82000,
        gross_amount_minor: 82000,
      }),
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.tradeoff.amount_kind).toBe("PRACTICAL_OPTIMIZATION_COST");
    expect(result.tradeoff.practical_cost_best_value_minor).toBe(65000);
    expect(result.tradeoff.practical_cost_best_quality_minor).toBe(82000);
    expect(result.tradeoff.cost_delta_minor).toBe(17000);
    expect(JSON.stringify(result)).not.toContain("final_payable_minor");
    expect(Object.keys(result.tradeoff)).not.toContain("final_payable_minor");
  });

  it("TEST 19 — No fabricated facts (baskets unchanged; no new catalog state)", () => {
    const bv = bestValueBasket();
    const bq = bestQualityBasket();
    const bvBefore = structuredClone(bv);
    const bqBefore = structuredClone(bq);
    const result = recommendBasket({ best_value: bv, best_quality: bq });
    expect(result.feasible).toBe(true);
    expect(bv).toEqual(bvBefore);
    expect(bq).toEqual(bqBefore);
    expect(Object.keys(result)).not.toContain("products");
    expect(Object.keys(result)).not.toContain("prices");
    expect(Object.keys(result)).not.toContain("evidence");
    expect(Object.keys(result.tradeoff)).not.toContain("invented_discount");
  });

  it("TEST 20 — Determinism", () => {
    const input = {
      best_value: bestValueBasket(),
      best_quality: bestQualityBasket(),
      explicit_preference: "NONE" as const,
      best_value_basket_id: "basket-value-001",
      best_quality_basket_id: "basket-quality-001",
    };
    const a = recommendBasket(input);
    const b = recommendBasket(input);
    const c = recommendBasket(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("TEST 21 — Reason determinism", () => {
    const input = {
      best_value: bestValueBasket({
        practical_cost_minor: 65000,
        gross_amount_minor: 65000,
        quality_signal: "GOOD" as const,
      }),
      best_quality: bestQualityBasket({
        practical_cost_minor: 69000,
        gross_amount_minor: 69000,
        quality_signal: "GOOD" as const,
      }),
    };
    const reasons = Array.from({ length: 5 }, () => recommendBasket(input).reason_code);
    expect(new Set(reasons).size).toBe(1);
    expect(reasons[0]).toBe("IMMATERIAL_QUALITY_DIFFERENCE");
  });

  it("TEST 22 — Decision metadata is categorical, not probability", () => {
    const result = recommendBasket({
      best_value: bestValueBasket(),
      best_quality: bestQualityBasket(),
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(RECOMMENDATION_DECISION_CLARITY).toContain(result.decision_clarity);
    expect(typeof result.decision_clarity).toBe("string");
    expect(result.decision_clarity).not.toMatch(/^\d/);
    // No invented probability thresholds on the result
    expect(Object.keys(result)).not.toContain("confidence");
    expect(Object.keys(result)).not.toContain("probability");
  });

  it("TEST 23 — Free-text / explanation prose alone cannot invent quality facts", () => {
    const bv = bestValueBasket({
      quality_signal: "GOOD",
      practical_cost_minor: 65000,
      gross_amount_minor: 65000,
    });
    const bqA = bestQualityBasket({
      quality_signal: "GOOD",
      practical_cost_minor: 69000,
      gross_amount_minor: 69000,
      explanation: {
        objective: "BEST_QUALITY",
        reasons: ["REQUIREMENTS_FULFILLED"],
        quality_floor: "ACCEPTABLE",
        excess_quantity_total: 0,
        incentive: emptyIncentive(),
      },
    });
    const bqB = {
      ...bqA,
      explanation: {
        ...bqA.explanation,
        // Prose-like reason set change without changing structured quality/cost
        reasons: [
          "REQUIREMENTS_FULFILLED",
          "HIGHEST_PRACTICAL_QUALITY",
          "MATERIAL_QUALITY_IMPROVEMENT",
        ] as BestQualityBasket["explanation"]["reasons"],
      },
    };
    const a = recommendBasket({ best_value: bv, best_quality: bqA });
    const b = recommendBasket({ best_value: bv, best_quality: bqB });
    expect(a.recommended_basket_type).toBe(b.recommended_basket_type);
    expect(a.reason_code).toBe(b.reason_code);
    expect(a.tradeoff.material_quality_difference).toBe(false);
    expect(b.tradeoff.material_quality_difference).toBe(false);
    expect(a.tradeoff.quality_rank_best_quality).toBe(
      b.tradeoff.quality_rank_best_quality,
    );
  });

  it("exports locked reason taxonomy", () => {
    expect(RECOMMENDATION_REASON_CODES).toContain("MATERIAL_QUALITY_ADVANTAGE");
    expect(RECOMMENDATION_REASON_CODES).toContain(
      "ACCEPTABLE_QUALITY_WITH_LOWER_COST",
    );
    expect(deriveBasketId(bestValueBasket())).toContain("BEST_VALUE:");
  });
});
