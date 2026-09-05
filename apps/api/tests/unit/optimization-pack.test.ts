import { describe, it, expect } from "vitest";
import {
  PACK_OPT_BOUNDS,
  comparePackCombinations,
  optimizePackCombinations,
  toPackCandidateInput,
  type OptimizationCandidate,
  type PackCandidateInput,
  type PackCombination,
  type PackQualitySnapshot,
} from "../../src/modules/optimization/index.js";
import {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";

function quality(
  signal: PackQualitySnapshot["quality_signal"],
  overrides: Partial<PackQualitySnapshot> = {},
): PackQualitySnapshot {
  return {
    quality_signal: signal,
    confidence: 0.9,
    evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01"],
    evidence_status: signal === null ? "NONE" : "SUFFICIENT",
    meets_minimum_quality:
      signal === null
        ? false
        : signal !== "UNACCEPTABLE",
    ...overrides,
  };
}

function candidate(
  overrides: Partial<OptimizationCandidate> &
    Pick<
      OptimizationCandidate,
      "product_id" | "sku_id" | "product_name" | "sku_code"
    >,
): OptimizationCandidate {
  return {
    brand: null,
    category_code: "dairy",
    product_status: "ACTIVE",
    sku_status: "ACTIVE",
    pack_quantity: 6,
    pack_unit: "pieces",
    price_minor: 3600,
    currency: "INR",
    stock_available: 24,
    ...overrides,
  };
}

const eggsRequirement = {
  item_name: "eggs",
  target_quantity: 6,
  unit: "pieces",
  minimum_quality: "ACCEPTABLE",
  constraints_json: [] as unknown[],
};

/** Canonical Doc 05 §7.2 candidates. */
const candidateA = candidate({
  product_id: SIX_EGG_SCENARIO.poorSixPack.product_id,
  sku_id: SIX_EGG_SCENARIO.poorSixPack.sku_id,
  product_name: "Farm Eggs",
  brand: "FarmFresh",
  sku_code: SIX_EGG_SCENARIO.poorSixPack.sku_code,
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: SIX_EGG_SCENARIO.poorSixPack.price_minor,
  stock_available: 24,
});

const candidateB = candidate({
  product_id: SIX_EGG_SCENARIO.goodSixPack.product_id,
  sku_id: SIX_EGG_SCENARIO.goodSixPack.sku_id,
  product_name: "Select Eggs",
  brand: "Select",
  sku_code: SIX_EGG_SCENARIO.goodSixPack.sku_code,
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: SIX_EGG_SCENARIO.goodSixPack.price_minor,
  stock_available: 30,
});

const candidateC = candidate({
  product_id: SIX_EGG_SCENARIO.goodTwoPack.product_id,
  sku_id: SIX_EGG_SCENARIO.goodTwoPack.sku_id,
  product_name: "Farm Eggs",
  brand: "FarmFresh",
  sku_code: SIX_EGG_SCENARIO.goodTwoPack.sku_code,
  pack_quantity: 2,
  pack_unit: "pieces",
  price_minor: SIX_EGG_SCENARIO.goodTwoPack.price_minor,
  stock_available: 48,
});

const qualityA = quality("UNACCEPTABLE", {
  evidence_refs: [SIX_EGG_SCENARIO.poorSixPack.evidence_id],
  meets_minimum_quality: false,
  confidence: 0.92,
});

const qualityB = quality("GOOD", {
  evidence_refs: [SIX_EGG_SCENARIO.goodSixPack.evidence_id],
  meets_minimum_quality: true,
  confidence: 0.9,
});

const qualityC = quality("GOOD", {
  evidence_refs: [SIX_EGG_SCENARIO.goodTwoPack.evidence_id],
  meets_minimum_quality: true,
  confidence: 0.88,
});

const defaultContext = {
  allowed_categories: ["dairy"],
};

function optimize(
  packs: PackCandidateInput[],
  requirement = eggsRequirement,
  context = defaultContext,
) {
  return optimizePackCombinations(requirement, packs, context);
}

function findBySku(
  combos: PackCombination[],
  skuId: string,
  packCount?: number,
): PackCombination | undefined {
  return combos.find((combo) =>
    combo.lines.some(
      (line) =>
        line.sku_id === skuId &&
        (packCount === undefined || line.pack_count === packCount),
    ),
  );
}

describe("Phase 5 Step 2 — pack optimization", () => {
  describe("24. canonical six-egg scenario", () => {
    it("rejects A, accepts B and C, and ranks C ahead of B", () => {
      const result = optimize([
        toPackCandidateInput(candidateA, qualityA),
        toPackCandidateInput(candidateB, qualityB),
        toPackCandidateInput(candidateC, qualityC),
      ]);

      const aIneligible = result.ineligible.find(
        (row) => row.candidate?.sku_id === candidateA.sku_id,
      );
      expect(aIneligible).toBeDefined();
      expect(aIneligible!.rejection_reasons).toContain(
        "REQUIREMENT_NOT_FULFILLED",
      );

      expect(result.ranked.length).toBeGreaterThanOrEqual(2);

      const winner = result.ranked[0]!;
      expect(winner.lines).toHaveLength(1);
      expect(winner.lines[0]!.sku_id).toBe(candidateC.sku_id);
      expect(winner.lines[0]!.pack_count).toBe(3);
      // 3 × 2-pack = 6 eggs; 3 × ₹12 = ₹36 (3600 paise) — not ₹12/egg.
      expect(winner.covered_quantity).toBe(6);
      expect(winner.excess_quantity).toBe(0);
      expect(winner.gross_amount_minor).toBe(3600);
      expect(Number.isInteger(winner.gross_amount_minor)).toBe(true);
      expect(winner.quality_signal).toBe("GOOD");

      const bCombo = findBySku(result.ranked, candidateB.sku_id, 1);
      expect(bCombo).toBeDefined();
      expect(bCombo!.gross_amount_minor).toBe(4200);
      expect(bCombo!.covered_quantity).toBe(6);

      const winnerIndex = result.ranked.findIndex(
        (c) => c.combination_key === winner.combination_key,
      );
      const bIndex = result.ranked.findIndex(
        (c) => c.combination_key === bCombo!.combination_key,
      );
      expect(winnerIndex).toBeLessThan(bIndex);
    });
  });

  it("1. exact single-pack coverage", () => {
    const result = optimize([toPackCandidateInput(candidateB, qualityB)]);
    const combo = result.ranked[0]!;
    expect(combo.covered_quantity).toBe(6);
    expect(combo.excess_quantity).toBe(0);
    expect(combo.pack_count_total).toBe(1);
    expect(combo.gross_amount_minor).toBe(4200);
  });

  it("2. exact multi-pack coverage", () => {
    const result = optimize([toPackCandidateInput(candidateC, qualityC)]);
    const combo = findBySku(result.ranked, candidateC.sku_id, 3)!;
    expect(combo.covered_quantity).toBe(6);
    expect(combo.excess_quantity).toBe(0);
    expect(combo.lines[0]!.pack_count).toBe(3);
    expect(combo.gross_amount_minor).toBe(3600);
  });

  it("3. combination with valid excess", () => {
    const result = optimize([toPackCandidateInput(candidateC, qualityC)]);
    const withExcess = findBySku(result.ranked, candidateC.sku_id, 4);
    expect(withExcess).toBeDefined();
    expect(withExcess!.covered_quantity).toBe(8);
    expect(withExcess!.excess_quantity).toBe(2);
    expect(withExcess!.gross_amount_minor).toBe(4800);
  });

  it("4. insufficient combination rejected", () => {
    const result = optimize([toPackCandidateInput(candidateC, qualityC)]);
    // 1 × 2-pack covers only 2 < 6 — must not appear as feasible.
    const insufficient = result.ranked.find(
      (c) =>
        c.lines.length === 1 &&
        c.lines[0]!.sku_id === candidateC.sku_id &&
        c.lines[0]!.pack_count === 1,
    );
    expect(insufficient).toBeUndefined();

    const rejectedOne = result.rejected_combinations.find(
      (c) =>
        c.lines.length === 1 &&
        c.lines[0]!.sku_id === candidateC.sku_id &&
        c.lines[0]!.pack_count === 1,
    );
    // May or may not be recorded depending on enumeration; ensure not ranked.
    if (rejectedOne) {
      expect(rejectedOne.feasible).toBe(false);
      expect(rejectedOne.rejection_reasons).toContain(
        "REQUIREMENT_NOT_FULFILLED",
      );
    }
  });

  it("5. smaller excess wins when other factors are equal", () => {
    const result = optimize([toPackCandidateInput(candidateC, qualityC)]);
    const exact = findBySku(result.ranked, candidateC.sku_id, 3)!;
    const excess = findBySku(result.ranked, candidateC.sku_id, 4)!;
    expect(comparePackCombinations(exact, excess)).toBeLessThan(0);
    expect(result.ranked.indexOf(exact)).toBeLessThan(
      result.ranked.indexOf(excess),
    );
  });

  it("6. unavailable pack rejected", () => {
    const oos = {
      ...candidateC,
      stock_available: 0,
    };
    const result = optimize([toPackCandidateInput(oos, qualityC)]);
    expect(result.ranked).toHaveLength(0);
    expect(
      result.ineligible.some((row) =>
        row.rejection_reasons.includes("OUT_OF_STOCK"),
      ),
    ).toBe(true);
  });

  it("7. inactive SKU rejected", () => {
    const result = optimize([
      toPackCandidateInput(
        { ...candidateB, sku_status: "INACTIVE" },
        qualityB,
      ),
    ]);
    expect(result.ranked).toHaveLength(0);
    expect(
      result.ineligible.some((row) =>
        row.rejection_reasons.includes("INACTIVE_SKU"),
      ),
    ).toBe(true);
  });

  it("8. inactive product rejected", () => {
    const result = optimize([
      toPackCandidateInput(
        { ...candidateB, product_status: "INACTIVE" },
        qualityB,
      ),
    ]);
    expect(result.ranked).toHaveLength(0);
    expect(
      result.ineligible.some((row) =>
        row.rejection_reasons.includes("INACTIVE_PRODUCT"),
      ),
    ).toBe(true);
  });

  it("9. disallowed category rejected", () => {
    const result = optimize(
      [toPackCandidateInput(candidateB, qualityB)],
      eggsRequirement,
      { allowed_categories: ["pantry"] },
    );
    expect(result.ranked).toHaveLength(0);
    expect(
      result.ineligible.some((row) =>
        row.rejection_reasons.includes("CATEGORY_NOT_ALLOWED"),
      ),
    ).toBe(true);
  });

  it("10. explicit exclusion rejected", () => {
    const result = optimize(
      [toPackCandidateInput(candidateB, qualityB)],
      {
        ...eggsRequirement,
        constraints_json: [{ type: "exclusion", value: "Select Eggs" }],
      },
    );
    expect(result.ranked).toHaveLength(0);
    expect(
      result.ineligible.some((row) =>
        row.rejection_reasons.includes("EXPLICITLY_EXCLUDED"),
      ),
    ).toBe(true);
  });

  it("11. max-per-item violation rejected", () => {
    const result = optimize(
      [toPackCandidateInput(candidateB, qualityB)],
      eggsRequirement,
      { ...defaultContext, max_per_item_minor: 4000 },
    );
    // B costs 4200 for one pack → exceeds max_per_item.
    expect(result.ranked).toHaveLength(0);
  });

  it("12. budget violation rejected", () => {
    const result = optimize(
      [toPackCandidateInput(candidateB, qualityB)],
      eggsRequirement,
      { ...defaultContext, budget_minor: 4000 },
    );
    expect(result.ranked).toHaveLength(0);
    expect(
      result.rejected_combinations.some((c) =>
        c.rejection_reasons.includes("BUDGET_EXCEEDED"),
      ) ||
        result.ineligible.some((row) =>
          row.rejection_reasons.includes("BUDGET_EXCEEDED"),
        ),
    ).toBe(true);
  });

  it("13. incompatible unit rejected", () => {
    const pasta = candidate({
      product_id: SEED_PRODUCT_IDS.durumPasta,
      sku_id: SEED_SKU_IDS.durumPasta500g,
      product_name: "Durum Pasta Eggs", // name contains eggs to isolate unit fail
      sku_code: "DURUM-PASTA-500G",
      pack_quantity: 500,
      pack_unit: "grams",
      category_code: "pantry",
      price_minor: 8500,
      stock_available: 40,
    });
    const result = optimize(
      [toPackCandidateInput(pasta, quality("GOOD"))],
      eggsRequirement,
      { allowed_categories: ["pantry", "dairy"] },
    );
    expect(result.ranked).toHaveLength(0);
    expect(
      result.ineligible.some((row) =>
        row.rejection_reasons.includes("REQUIREMENT_NOT_FULFILLED"),
      ),
    ).toBe(true);
  });

  it("14. missing pack quantity rejected", () => {
    const result = optimize([
      {
        candidate: { ...candidateB, pack_quantity: undefined as unknown as number },
        quality: qualityB,
      },
    ]);
    expect(result.ranked).toHaveLength(0);
    expect(
      result.ineligible.some((row) =>
        row.rejection_reasons.includes("MISSING_AUTHORITATIVE_DATA"),
      ),
    ).toBe(true);
  });

  it("15. invalid/non-positive pack quantity rejected", () => {
    const result = optimize([
      {
        candidate: { ...candidateB, pack_quantity: 0 },
        quality: qualityB,
      },
    ]);
    expect(result.ranked).toHaveLength(0);
    expect(
      result.ineligible.some((row) =>
        row.rejection_reasons.includes("INVALID_QUANTITY"),
      ),
    ).toBe(true);
  });

  it("16–17. integer money only; no floating-point arithmetic", () => {
    const result = optimize([toPackCandidateInput(candidateC, qualityC)]);
    const winner = findBySku(result.ranked, candidateC.sku_id, 3)!;
    expect(Number.isInteger(winner.gross_amount_minor)).toBe(true);
    expect(Number.isInteger(winner.lines[0]!.unit_price_minor)).toBe(true);
    expect(Number.isInteger(winner.lines[0]!.line_amount_minor)).toBe(true);
    expect(winner.gross_amount_minor).toBe(3 * 1200);
    // Explicit: pack price is per pack, not per egg (would be 3*2*1200 if wrong).
    expect(winner.gross_amount_minor).not.toBe(7200);
  });

  it("18. same input gives same ordered output", () => {
    const packs = [
      toPackCandidateInput(candidateA, qualityA),
      toPackCandidateInput(candidateB, qualityB),
      toPackCandidateInput(candidateC, qualityC),
    ];
    const a = optimize(packs);
    const b = optimize(packs);
    expect(a.ranked.map((c) => c.combination_key)).toEqual(
      b.ranked.map((c) => c.combination_key),
    );
    expect(a.explored_count).toBe(b.explored_count);
  });

  it("19. poor quality cannot beat acceptable merely because cheaper", () => {
    const result = optimize([
      toPackCandidateInput(candidateA, qualityA),
      toPackCandidateInput(candidateB, qualityB),
    ]);
    expect(
      result.ranked.every(
        (c) => !c.lines.some((l) => l.sku_id === candidateA.sku_id),
      ),
    ).toBe(true);
    expect(findBySku(result.ranked, candidateB.sku_id)).toBeDefined();
  });

  it("20. equal cost + better quality ranks better", () => {
    const cheapAcceptable = toPackCandidateInput(
      {
        ...candidateB,
        sku_id: "33333333-3333-4333-8333-3333333333a1",
        sku_code: "EGGS-ACC-6",
        product_name: "Acceptable Eggs",
        price_minor: 3600,
      },
      quality("ACCEPTABLE", {
        evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04"],
        meets_minimum_quality: true,
      }),
    );
    const cheapGood = toPackCandidateInput(
      {
        ...candidateB,
        sku_id: "33333333-3333-4333-8333-3333333333a2",
        sku_code: "EGGS-GOOD-6",
        product_name: "Good Eggs",
        price_minor: 3600,
      },
      quality("GOOD", {
        evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
        meets_minimum_quality: true,
      }),
    );
    const result = optimize([cheapAcceptable, cheapGood]);
    expect(result.ranked[0]!.quality_signal).toBe("GOOD");
    expect(result.ranked[0]!.gross_amount_minor).toBe(3600);
  });

  it("21. equal quality + lower cost ranks better", () => {
    const result = optimize([
      toPackCandidateInput(candidateB, qualityB),
      toPackCandidateInput(candidateC, qualityC),
    ]);
    expect(result.ranked[0]!.gross_amount_minor).toBe(3600);
    expect(result.ranked[0]!.lines[0]!.sku_id).toBe(candidateC.sku_id);
  });

  it("22. equal cost/quality + lower excess ranks better", () => {
    const result = optimize([toPackCandidateInput(candidateC, qualityC)]);
    const exact = findBySku(result.ranked, candidateC.sku_id, 3)!;
    const excess = findBySku(result.ranked, candidateC.sku_id, 4)!;
    expect(exact.gross_amount_minor).toBeLessThan(excess.gross_amount_minor);
    // Force equal cost via compare on two synthetic equal-cost rows:
    const equalCostLowerExcess: PackCombination = {
      ...exact,
      gross_amount_minor: 4800,
      excess_quantity: 0,
      combination_key: "test-low-excess",
    };
    const equalCostHigherExcess: PackCombination = {
      ...excess,
      gross_amount_minor: 4800,
      excess_quantity: 2,
      combination_key: "test-high-excess",
    };
    expect(
      comparePackCombinations(equalCostLowerExcess, equalCostHigherExcess),
    ).toBeLessThan(0);
  });

  it("23. final deterministic SKU tie-breaker", () => {
    const left = toPackCandidateInput(
      {
        ...candidateB,
        sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
        sku_code: "AAA-EGGS-6",
        product_name: "Alpha Eggs",
        price_minor: 4000,
      },
      quality("GOOD", {
        evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
        meets_minimum_quality: true,
      }),
    );
    const right = toPackCandidateInput(
      {
        ...candidateB,
        sku_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
        sku_code: "BBB-EGGS-6",
        product_name: "Beta Eggs",
        price_minor: 4000,
      },
      quality("GOOD", {
        evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02"],
        meets_minimum_quality: true,
      }),
    );
    const result = optimize([right, left]);
    expect(result.ranked[0]!.lines[0]!.sku_id).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
    );
  });

  it("25–26. same-SKU combinations and search bounds are enforced", () => {
    const result = optimize([toPackCandidateInput(candidateC, qualityC)]);
    const sameSkuCounts = result.ranked
      .filter((c) => c.lines.every((l) => l.sku_id === candidateC.sku_id))
      .map((c) => c.lines[0]!.pack_count);
    expect(Math.max(...sameSkuCounts)).toBeLessThanOrEqual(
      PACK_OPT_BOUNDS.MAX_PACKS_PER_SKU,
    );
    expect(result.explored_count).toBeLessThanOrEqual(
      PACK_OPT_BOUNDS.MAX_COMBINATIONS_EXPLORED,
    );
    expect(result.ranked.length).toBeLessThanOrEqual(
      PACK_OPT_BOUNDS.MAX_COMBINATIONS_RETURNED,
    );
    // Extra packs beyond minimum are bounded.
    expect(Math.max(...sameSkuCounts)).toBeLessThanOrEqual(
      3 + PACK_OPT_BOUNDS.MAX_EXTRA_PACKS_BEYOND_MIN,
    );
  });

  it("27. no unrelated product added merely because budget remains", () => {
    const milk = toPackCandidateInput(
      candidate({
        product_id: SEED_PRODUCT_IDS.freshMilk,
        sku_id: SEED_SKU_IDS.freshMilk1l,
        product_name: "Fresh Milk",
        sku_code: "FRESH-MILK-1L",
        pack_quantity: 1,
        pack_unit: "litre",
        price_minor: 6200,
        stock_available: 18,
      }),
      quality("ACCEPTABLE", {
        evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04"],
        meets_minimum_quality: true,
      }),
    );
    const result = optimize(
      [toPackCandidateInput(candidateC, qualityC), milk],
      eggsRequirement,
      { ...defaultContext, budget_minor: 1_000_000 },
    );
    expect(
      result.ranked.every((c) =>
        c.lines.every((l) => l.sku_id !== SEED_SKU_IDS.freshMilk1l),
      ),
    ).toBe(true);
  });

  it("28. PACKS_COUNT_AS_SKU_PURCHASES remains intact for pasta packs", () => {
    const pastaReq = {
      item_name: "pasta",
      target_quantity: 2,
      unit: "packs",
      minimum_quality: null as string | null,
      constraints_json: [] as unknown[],
    };
    const pasta = toPackCandidateInput(
      candidate({
        product_id: SEED_PRODUCT_IDS.durumPasta,
        sku_id: SEED_SKU_IDS.durumPasta500g,
        product_name: "Durum Pasta",
        sku_code: "DURUM-PASTA-500G",
        pack_quantity: 500,
        pack_unit: "grams",
        category_code: "pantry",
        price_minor: 8500,
        stock_available: 40,
      }),
      quality("GOOD", {
        evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05"],
        meets_minimum_quality: null,
      }),
    );
    const result = optimizePackCombinations(pastaReq, [pasta], {
      allowed_categories: ["pantry"],
    });
    const winner = result.ranked[0]!;
    expect(winner.covered_quantity).toBe(2);
    expect(winner.lines[0]!.pack_count).toBe(2);
    expect(winner.lines[0]!.units_per_pack).toBe(1);
    expect(winner.assumptions.map((a) => a.code)).toContain(
      "PACKS_COUNT_AS_SKU_PURCHASES",
    );
    expect(winner.gross_amount_minor).toBe(17000);
  });
});
