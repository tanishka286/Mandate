import { describe, it, expect } from "vitest";
import {
  evaluateCandidateFeasibility,
  filterFeasibleCandidates,
  evaluateRequirementFulfillment,
  evaluateUnitCompatibility,
  optimizationCandidateSchema,
  optimizationRequirementSchema,
  type OptimizationCandidate,
  type OptimizationRequirement,
} from "../../src/modules/optimization/index.js";
import {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";

/** Authoritative Farm Eggs 6-pack (seeded) — active, in stock. */
const farmEggs6: OptimizationCandidate = {
  product_id: SEED_PRODUCT_IDS.farmEggs,
  sku_id: SEED_SKU_IDS.farmEggs6,
  product_name: "Farm Eggs",
  brand: "FarmFresh",
  category_code: "dairy",
  product_status: "ACTIVE",
  sku_status: "ACTIVE",
  sku_code: SIX_EGG_SCENARIO.poorSixPack.sku_code,
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: SIX_EGG_SCENARIO.poorSixPack.price_minor,
  currency: "INR",
  stock_available: 24,
};

const farmEggs2: OptimizationCandidate = {
  product_id: SEED_PRODUCT_IDS.farmEggs,
  sku_id: SEED_SKU_IDS.farmEggs2,
  product_name: "Farm Eggs",
  brand: "FarmFresh",
  category_code: "dairy",
  product_status: "ACTIVE",
  sku_status: "ACTIVE",
  sku_code: SIX_EGG_SCENARIO.goodTwoPack.sku_code,
  pack_quantity: 2,
  pack_unit: "pieces",
  price_minor: SIX_EGG_SCENARIO.goodTwoPack.price_minor,
  currency: "INR",
  stock_available: 48,
};

const selectEggs6: OptimizationCandidate = {
  product_id: SEED_PRODUCT_IDS.selectEggs,
  sku_id: SEED_SKU_IDS.selectEggs6,
  product_name: "Select Eggs",
  brand: "Select",
  category_code: "dairy",
  product_status: "ACTIVE",
  sku_status: "ACTIVE",
  sku_code: SIX_EGG_SCENARIO.goodSixPack.sku_code,
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: SIX_EGG_SCENARIO.goodSixPack.price_minor,
  currency: "INR",
  stock_available: 30,
};

/** Seeded sandwich bread — deliberately out of stock. */
const sandwichBreadOos: OptimizationCandidate = {
  product_id: SEED_PRODUCT_IDS.sandwichBread,
  sku_id: SEED_SKU_IDS.sandwichBread400g,
  product_name: "Sandwich Bread",
  brand: null,
  category_code: "pantry",
  product_status: "ACTIVE",
  sku_status: "ACTIVE",
  sku_code: "SANDWICH-BREAD-400G",
  pack_quantity: 400,
  pack_unit: "grams",
  price_minor: 4500,
  currency: "INR",
  stock_available: 0,
};

const freshMilk: OptimizationCandidate = {
  product_id: SEED_PRODUCT_IDS.freshMilk,
  sku_id: SEED_SKU_IDS.freshMilk1l,
  product_name: "Fresh Milk",
  brand: null,
  category_code: "dairy",
  product_status: "ACTIVE",
  sku_status: "ACTIVE",
  sku_code: "FRESH-MILK-1L",
  pack_quantity: 1,
  pack_unit: "litre",
  price_minor: 6200,
  currency: "INR",
  stock_available: 18,
};

const durumPasta500g: OptimizationCandidate = {
  product_id: SEED_PRODUCT_IDS.durumPasta,
  sku_id: SEED_SKU_IDS.durumPasta500g,
  product_name: "Durum Pasta",
  brand: null,
  category_code: "pantry",
  product_status: "ACTIVE",
  sku_status: "ACTIVE",
  sku_code: "DURUM-PASTA-500G",
  pack_quantity: 500,
  pack_unit: "grams",
  price_minor: 8500,
  currency: "INR",
  stock_available: 40,
};

const eggsRequirement: OptimizationRequirement = {
  item_name: "eggs",
  target_quantity: 6,
  unit: "pieces",
  minimum_quality: null,
  constraints_json: [],
};

describe("optimization candidate schema", () => {
  it("accepts authoritative integer minor-unit prices", () => {
    const parsed = optimizationCandidateSchema.parse(farmEggs6);
    expect(parsed.price_minor).toBe(3600);
    expect(Number.isInteger(parsed.price_minor)).toBe(true);
  });

  it("rejects floating-point price_minor", () => {
    expect(() =>
      optimizationCandidateSchema.parse({
        ...farmEggs6,
        price_minor: 36.5,
      }),
    ).toThrow();
  });

  it("rejects client-provided final_payable as candidate authority", () => {
    expect(() =>
      optimizationCandidateSchema.parse({
        ...farmEggs6,
        final_payable_minor: 3600,
      }),
    ).toThrow();
  });

  it("rejects free-text summary fields on candidates", () => {
    expect(() =>
      optimizationCandidateSchema.parse({
        ...farmEggs6,
        summary: "Looks great and totally in stock",
      }),
    ).toThrow();
  });
});

describe("evaluateCandidateFeasibility", () => {
  it("1. accepts an active, in-stock candidate as feasible", () => {
    const result = evaluateCandidateFeasibility(farmEggs6, {
      allowed_categories: ["dairy"],
      proposed_quantity: 1,
    });
    expect(result.feasible).toBe(true);
    expect(result.rejection_reasons).toEqual([]);
    expect(result.line_amount_minor).toBe(3600);
    expect(Number.isInteger(result.line_amount_minor)).toBe(true);
  });

  it("2. rejects an inactive SKU", () => {
    const result = evaluateCandidateFeasibility(
      { ...farmEggs6, sku_status: "INACTIVE" },
      { allowed_categories: ["dairy"] },
    );
    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons).toContain("INACTIVE_SKU");
  });

  it("3. rejects an inactive product", () => {
    const result = evaluateCandidateFeasibility(
      { ...farmEggs6, product_status: "INACTIVE" },
      { allowed_categories: ["dairy"] },
    );
    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons).toContain("INACTIVE_PRODUCT");
  });

  it("4. rejects an out-of-stock candidate", () => {
    const result = evaluateCandidateFeasibility(sandwichBreadOos, {
      allowed_categories: ["pantry"],
    });
    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons).toContain("OUT_OF_STOCK");
  });

  it("5. rejects a disallowed category", () => {
    const result = evaluateCandidateFeasibility(farmEggs6, {
      allowed_categories: ["pantry", "produce"],
    });
    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons).toContain("CATEGORY_NOT_ALLOWED");
  });

  it("6. rejects an explicitly excluded candidate", () => {
    const result = evaluateCandidateFeasibility(farmEggs6, {
      allowed_categories: ["dairy"],
      requirement: {
        ...eggsRequirement,
        constraints_json: [{ type: "exclusion", value: "Farm Eggs" }],
      },
    });
    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons).toContain("EXPLICITLY_EXCLUDED");
  });

  it("7. rejects invalid / non-positive quantity", () => {
    const zero = evaluateCandidateFeasibility(farmEggs6, {
      allowed_categories: ["dairy"],
      proposed_quantity: 0,
    });
    expect(zero.feasible).toBe(false);
    expect(zero.rejection_reasons).toContain("INVALID_QUANTITY");

    const negative = evaluateCandidateFeasibility(farmEggs6, {
      allowed_categories: ["dairy"],
      proposed_quantity: -1,
    });
    expect(negative.feasible).toBe(false);
    expect(negative.rejection_reasons).toContain("INVALID_QUANTITY");

    const floatQty = evaluateCandidateFeasibility(farmEggs6, {
      allowed_categories: ["dairy"],
      proposed_quantity: 1.5,
    });
    expect(floatQty.feasible).toBe(false);
    expect(floatQty.rejection_reasons).toContain("INVALID_QUANTITY");
  });

  it("8. rejects a candidate line that exceeds the hard budget ceiling", () => {
    const result = evaluateCandidateFeasibility(selectEggs6, {
      allowed_categories: ["dairy"],
      proposed_quantity: 1,
      // Select Eggs 6-pack is ₹42.00 = 4200 paise
      budget_minor: 4000,
    });
    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons).toContain("BUDGET_EXCEEDED");
    expect(result.line_amount_minor).toBe(4200);
    expect(Number.isInteger(result.line_amount_minor)).toBe(true);
  });

  it("11. missing/insufficient authoritative data does not fabricate a positive", () => {
    const missingStock = evaluateCandidateFeasibility({
      ...farmEggs6,
      stock_available: null,
    });
    expect(missingStock.feasible).toBe(false);
    expect(missingStock.rejection_reasons).toContain("OUT_OF_STOCK");

    // Float price cannot parse as authoritative candidate.
    expect(() =>
      evaluateCandidateFeasibility({
        ...farmEggs6,
        price_minor: 36.99 as unknown as number,
      }),
    ).toThrow();
  });

  it("12. same input produces the same output (deterministic)", () => {
    const input = {
      allowed_categories: ["dairy", "pantry"],
      proposed_quantity: 2,
      budget_minor: 100000,
    };
    const a = evaluateCandidateFeasibility(farmEggs2, input);
    const b = evaluateCandidateFeasibility(farmEggs2, input);
    expect(a).toEqual(b);

    const filteredA = filterFeasibleCandidates(
      [selectEggs6, farmEggs2, sandwichBreadOos, farmEggs6],
      input,
    );
    const filteredB = filterFeasibleCandidates(
      [selectEggs6, farmEggs2, sandwichBreadOos, farmEggs6],
      input,
    );
    expect(filteredA).toEqual(filteredB);
    // Deterministic ordering by sku_id
    expect(filteredA.feasible.map((c) => c.sku_id)).toEqual(
      [...filteredA.feasible.map((c) => c.sku_id)].sort((x, y) =>
        x.localeCompare(y),
      ),
    );
  });

  it("does not treat remaining budget as a reason to invent feasibility", () => {
    // Budget far above line cost — still only feasible if hard constraints pass.
    const result = evaluateCandidateFeasibility(sandwichBreadOos, {
      allowed_categories: ["pantry"],
      budget_minor: 1_000_000,
    });
    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons).toContain("OUT_OF_STOCK");
  });

  it("applies max_per_item hard ceiling when provided", () => {
    const result = evaluateCandidateFeasibility(selectEggs6, {
      allowed_categories: ["dairy"],
      max_per_item_minor: 4000,
    });
    expect(result.feasible).toBe(false);
    expect(result.rejection_reasons).toContain("MAX_PER_ITEM_EXCEEDED");
  });
});

describe("evaluateRequirementFulfillment", () => {
  it("9. accepts a candidate that satisfies the requirement", () => {
    const result = evaluateRequirementFulfillment(
      eggsRequirement,
      selectEggs6,
    );
    expect(result.can_contribute).toBe(true);
    expect(result.can_fulfill).toBe(true);
    expect(result.covered_quantity).toBe(6);
    expect(result.rejection_reasons).toEqual([]);
  });

  it("10. rejects a candidate that cannot satisfy the requirement", () => {
    const wrongItem = evaluateRequirementFulfillment(
      eggsRequirement,
      freshMilk,
    );
    expect(wrongItem.can_fulfill).toBe(false);
    expect(wrongItem.can_contribute).toBe(false);
    expect(wrongItem.rejection_reasons).toContain("REQUIREMENT_NOT_FULFILLED");

    const insufficientPack = evaluateRequirementFulfillment(
      eggsRequirement,
      farmEggs2,
      { proposed_quantity: 1 },
    );
    expect(insufficientPack.can_contribute).toBe(true);
    expect(insufficientPack.can_fulfill).toBe(false);
    expect(insufficientPack.covered_quantity).toBe(2);
    expect(insufficientPack.rejection_reasons).toContain(
      "REQUIREMENT_NOT_FULFILLED",
    );
  });

  it("does not invent unit conversions between grams and pieces", () => {
    const compat = evaluateUnitCompatibility(eggsRequirement, durumPasta500g);
    expect(compat.compatible).toBe(false);
    expect(compat.units_per_sku).toBeNull();

    const result = evaluateRequirementFulfillment(
      eggsRequirement,
      durumPasta500g,
    );
    expect(result.can_fulfill).toBe(false);
    expect(result.rejection_reasons).toContain("REQUIREMENT_NOT_FULFILLED");
  });

  it("records explicit packs assumption for Phase 3 pasta requirements", () => {
    const pastaReq = optimizationRequirementSchema.parse({
      item_name: "pasta",
      target_quantity: 2,
      unit: "packs",
      minimum_quality: null,
      constraints_json: [],
    });
    const result = evaluateRequirementFulfillment(pastaReq, durumPasta500g);
    expect(result.can_fulfill).toBe(true);
    expect(result.covered_quantity).toBe(2);
    expect(result.assumptions.map((a) => a.code)).toContain(
      "PACKS_COUNT_AS_SKU_PURCHASES",
    );
  });

  it("never uses free-text as fulfillment evidence", () => {
    // Candidate schema is strict — summary cannot sneak in as authority.
    expect(() =>
      evaluateRequirementFulfillment(eggsRequirement, {
        ...selectEggs6,
        // @ts-expect-error — summary must not be authoritative
        assessment_summary: "Perfect for eggs requirement",
      }),
    ).toThrow();
  });

  it("12. fulfillment is deterministic for the same inputs", () => {
    const a = evaluateRequirementFulfillment(eggsRequirement, farmEggs2);
    const b = evaluateRequirementFulfillment(eggsRequirement, farmEggs2);
    expect(a).toEqual(b);
    // Default purchase qty is ceil(6/2) = 3 → fulfills
    expect(a.can_fulfill).toBe(true);
    expect(a.proposed_quantity).toBe(3);
    expect(a.covered_quantity).toBe(6);
  });
});
