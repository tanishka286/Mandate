import { describe, it, expect } from "vitest";
import {
  evidenceSupportsMaterialQualityClaim,
  generateBestQualityBasket,
  generateBestValueBasket,
  hasMaterialQualityImprovement,
  rankingQualityRankForBestQuality,
  toQualityRank,
  type OptimizationCandidate,
  type PackCandidateInput,
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
      signal === null ? false : signal !== "UNACCEPTABLE",
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
    category_code: "grocery",
    product_status: "ACTIVE",
    sku_status: "ACTIVE",
    pack_quantity: 1,
    pack_unit: "pieces",
    price_minor: 1000,
    currency: "INR",
    stock_available: 24,
    ...overrides,
  };
}

function pack(
  c: OptimizationCandidate,
  signal: PackQualitySnapshot["quality_signal"],
  qOverrides: Partial<PackQualitySnapshot> = {},
): PackCandidateInput {
  return { candidate: c, quality: quality(signal, qOverrides) };
}

const eggsReq = {
  item_name: "eggs",
  target_quantity: 6,
  unit: "pieces",
  minimum_quality: "ACCEPTABLE",
  constraints_json: [] as unknown[],
};

const acceptableCheap = candidate({
  product_id: SEED_PRODUCT_IDS.farmEggs,
  sku_id: "33333333-3333-4333-8333-333333333391",
  product_name: "Farm Eggs Acceptable",
  brand: "FarmFresh",
  sku_code: "EGGS-ACC-CHEAP",
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: 4000,
  category_code: "dairy",
});

const premiumStrong = candidate({
  product_id: SEED_PRODUCT_IDS.selectEggs,
  sku_id: "33333333-3333-4333-8333-333333333392",
  product_name: "Select Eggs Premium",
  brand: "Select",
  sku_code: "EGGS-PREM",
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: 8000,
  category_code: "dairy",
});

const premiumOverBudget = candidate({
  ...premiumStrong,
  sku_id: "33333333-3333-4333-8333-333333333393",
  sku_code: "EGGS-PREM-HIGH",
  price_minor: 110_000,
});

const acceptableSame = candidate({
  product_id: SEED_PRODUCT_IDS.farmEggs,
  sku_id: "33333333-3333-4333-8333-333333333394",
  product_name: "Farm Eggs Acceptable B",
  brand: "FarmFresh",
  sku_code: "EGGS-ACC-B",
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: 4200,
  category_code: "dairy",
});

const goodStrong = candidate({
  product_id: SIX_EGG_SCENARIO.goodSixPack.product_id,
  sku_id: SIX_EGG_SCENARIO.goodSixPack.sku_id,
  product_name: "Select Eggs",
  brand: "Select",
  sku_code: SIX_EGG_SCENARIO.goodSixPack.sku_code,
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: SIX_EGG_SCENARIO.goodSixPack.price_minor,
  category_code: "dairy",
});

const poorSix = candidate({
  product_id: SIX_EGG_SCENARIO.poorSixPack.product_id,
  sku_id: SIX_EGG_SCENARIO.poorSixPack.sku_id,
  product_name: "Farm Eggs",
  brand: "FarmFresh",
  sku_code: SIX_EGG_SCENARIO.poorSixPack.sku_code,
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: SIX_EGG_SCENARIO.poorSixPack.price_minor,
  category_code: "dairy",
});

const premiumWeak = candidate({
  product_id: SEED_PRODUCT_IDS.selectEggs,
  sku_id: "33333333-3333-4333-8333-333333333395",
  product_name: "Select Eggs Claimed Premium",
  brand: "Select",
  sku_code: "EGGS-WEAK-PREM",
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: 9000,
  category_code: "dairy",
});

describe("Phase 5 Step 8 — Best Quality basket generation", () => {
  it("TEST 1 — higher quality within budget is selected", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(acceptableCheap, "ACCEPTABLE"),
            pack(premiumStrong, "PREMIUM", {
              evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
              confidence: 0.95,
            }),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.basket_type).toBe("BEST_QUALITY");
    expect(result.basket.quality_signal).toBe("PREMIUM");
    expect(result.basket.items.some((i) => i.sku_id === premiumStrong.sku_id)).toBe(
      true,
    );
    expect(result.basket.practical_cost_minor).toBe(8000);
  });

  it("TEST 2 — higher quality exceeding budget is rejected", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(acceptableCheap, "ACCEPTABLE"),
            pack(premiumOverBudget, "PREMIUM", { confidence: 0.95 }),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.practical_cost_minor).toBe(4000);
    expect(
      result.basket.items.every((i) => i.sku_id !== premiumOverBudget.sku_id),
    ).toBe(true);
  });

  it("TEST 3 — large unused budget does not add filler", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [pack(acceptableCheap, "ACCEPTABLE")],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.practical_cost_minor).toBe(4000);
    expect(result.basket.items.length).toBe(1);
    expect(result.basket.explanation.reasons).toContain("NO_UNNECESSARY_ITEMS");
  });

  it("TEST 4 — immaterial quality difference prefers lower cost", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(acceptableCheap, "ACCEPTABLE"),
            pack(acceptableSame, "ACCEPTABLE"),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.practical_cost_minor).toBe(4000);
    expect(
      result.basket.items.some((i) => i.sku_id === acceptableCheap.sku_id),
    ).toBe(true);
  });

  it("TEST 5 — weak quality evidence does not claim unsupported premium", () => {
    // Step 3 / Phase 4 evidence_status drives fail-closed ranking — not a
    // Best-Quality-invented confidence threshold.
    expect(
      rankingQualityRankForBestQuality("PREMIUM", "WEAK"),
    ).toBe(toQualityRank(null));
    expect(
      rankingQualityRankForBestQuality("PREMIUM", "SUFFICIENT"),
    ).toBe(toQualityRank("PREMIUM"));
    expect(evidenceSupportsMaterialQualityClaim("WEAK")).toBe(false);
    expect(evidenceSupportsMaterialQualityClaim("SUFFICIENT")).toBe(true);

    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(goodStrong, "GOOD", {
              confidence: 0.9,
              evidence_status: "SUFFICIENT",
              evidence_refs: [SIX_EGG_SCENARIO.goodSixPack.evidence_id],
            }),
            pack(premiumWeak, "PREMIUM", {
              confidence: 0.2,
              evidence_status: "WEAK",
              evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee09"],
            }),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    // Weak PREMIUM unsupported; GOOD with sufficient evidence wins.
    expect(
      result.basket.items.some((i) => i.sku_id === goodStrong.sku_id),
    ).toBe(true);
    expect(
      result.basket.items.every((i) => i.sku_id !== premiumWeak.sku_id),
    ).toBe(true);
    expect(result.basket.quality_signal).toBe("GOOD");
  });

  it("TEST 5b — no invented Best Quality confidence threshold", () => {
    // Low confidence alone does not demote when Phase 4 status is SUFFICIENT.
    expect(
      rankingQualityRankForBestQuality("PREMIUM", "SUFFICIENT"),
    ).toBe(toQualityRank("PREMIUM"));
    expect(
      hasMaterialQualityImprovement(
        { ranking_quality_rank: toQualityRank("PREMIUM") },
        { ranking_quality_rank: toQualityRank("GOOD") },
      ),
    ).toBe(true);

    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(goodStrong, "GOOD", {
              confidence: 0.95,
              evidence_status: "SUFFICIENT",
            }),
            pack(premiumWeak, "PREMIUM", {
              // Below Phase 4's assessor threshold, but status already SUFFICIENT —
              // Best Quality must not re-apply an invented 0.5 cap.
              confidence: 0.4,
              evidence_status: "SUFFICIENT",
              evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee0a"],
            }),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(
      result.basket.items.some((i) => i.sku_id === premiumWeak.sku_id),
    ).toBe(true);
  });

  it("TEST 5c — uncertainty prefers higher confidence among same quality", () => {
    const goodLowerConf = candidate({
      ...goodStrong,
      sku_id: "33333333-3333-4333-8333-333333333396",
      sku_code: "EGGS-GOOD-LOWCONF",
      price_minor: 5500,
    });
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(goodStrong, "GOOD", {
              confidence: 0.95,
              evidence_status: "SUFFICIENT",
            }),
            pack(goodLowerConf, "GOOD", {
              confidence: 0.55,
              evidence_status: "SUFFICIENT",
            }),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(
      result.basket.items.some((i) => i.sku_id === goodStrong.sku_id),
    ).toBe(true);
    expect(result.basket.confidence).toBe(0.95);
  });

  it("TEST 6 — UNACCEPTABLE cannot win", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(poorSix, "UNACCEPTABLE", { meets_minimum_quality: false }),
            pack(goodStrong, "GOOD"),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(
      result.basket.items.every((i) => i.sku_id !== poorSix.sku_id),
    ).toBe(true);
  });

  it("TEST 7 — below minimum quality rejected before scoring", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(poorSix, "UNACCEPTABLE", { meets_minimum_quality: false }),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(false);
  });

  it("TEST 8 — every requirement must be satisfied", () => {
    const pasta = pack(
      candidate({
        product_id: SEED_PRODUCT_IDS.durumPasta,
        sku_id: SEED_SKU_IDS.durumPasta500g,
        product_name: "Durum Pasta",
        sku_code: "PASTA-500",
        pack_quantity: 1,
        pack_unit: "packs",
        price_minor: 8000,
      }),
      "GOOD",
    );
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: {
            item_name: "pasta",
            target_quantity: 1,
            unit: "packs",
            minimum_quality: "ACCEPTABLE",
          },
          pack_candidates: [pasta],
        },
        {
          requirement: {
            item_name: "sauce",
            target_quantity: 1,
            unit: "packs",
            minimum_quality: "ACCEPTABLE",
          },
          pack_candidates: [],
        },
      ],
    });
    expect(result.feasible).toBe(false);
    if (result.feasible) return;
    expect(result.requirement_failures.length).toBeGreaterThan(0);
  });

  it("TEST 9 — pack optimization reused (3×2-pack)", () => {
    const two = candidate({
      product_id: SIX_EGG_SCENARIO.goodTwoPack.product_id,
      sku_id: SIX_EGG_SCENARIO.goodTwoPack.sku_id,
      product_name: "Farm Eggs",
      brand: "FarmFresh",
      sku_code: SIX_EGG_SCENARIO.goodTwoPack.sku_code,
      pack_quantity: 2,
      pack_unit: "pieces",
      price_minor: SIX_EGG_SCENARIO.goodTwoPack.price_minor,
      category_code: "dairy",
    });
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(poorSix, "UNACCEPTABLE", { meets_minimum_quality: false }),
            pack(two, "GOOD"),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.items[0]?.quantity).toBe(3);
    expect(result.basket.practical_cost_minor).toBe(3600);
  });

  it("TEST 10 — USE_NOW incentive applied once", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: {
            item_name: "pasta",
            target_quantity: 1,
            unit: "packs",
            minimum_quality: "ACCEPTABLE",
          },
          pack_candidates: [
            pack(
              candidate({
                product_id: SEED_PRODUCT_IDS.durumPasta,
                sku_id: SEED_SKU_IDS.durumPasta500g,
                product_name: "Durum Pasta",
                sku_code: "PASTA-500",
                pack_quantity: 1,
                pack_unit: "packs",
                price_minor: 60_000,
              }),
              "GOOD",
            ),
          ],
        },
      ],
      vouchers: [
        {
          voucher_id: "v-use",
          authority: "BACKEND_DEFINED_VOUCHER",
          source_reference: "backend:voucher:use",
          threshold_minor: 50_000,
          discount_minor: 10_000,
          validity: "VALID",
          eligibility: "ELIGIBLE",
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.explanation.incentive.voucher_decision).toBe("USE_NOW");
    expect(result.basket.explanation.incentive.voucher_benefit_minor).toBe(
      10_000,
    );
    expect(result.basket.practical_cost_minor).toBe(50_000);
  });

  it("TEST 11 — SAVE_FOR_LATER attributes zero current saving", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [pack(acceptableCheap, "ACCEPTABLE")],
        },
      ],
      vouchers: [
        {
          voucher_id: "v-save",
          authority: "BACKEND_DEFINED_VOUCHER",
          source_reference: "backend:voucher:save",
          threshold_minor: 0,
          discount_minor: 500,
          validity: "VALID",
          eligibility: "ELIGIBLE",
          future_use_value_minor: 5_000,
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.explanation.incentive.voucher_decision).toBe(
      "SAVE_FOR_LATER",
    );
    expect(result.basket.explanation.incentive.voucher_benefit_minor).toBe(0);
    expect(result.basket.practical_cost_minor).toBe(4000);
  });

  it("TEST 12 — DO_NOT_USE attributes zero current saving", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [pack(acceptableCheap, "ACCEPTABLE")],
        },
      ],
      vouchers: [
        {
          voucher_id: "v-exp",
          authority: "BACKEND_DEFINED_VOUCHER",
          source_reference: "backend:voucher:exp",
          threshold_minor: 0,
          discount_minor: 1000,
          validity: "EXPIRED",
          eligibility: "ELIGIBLE",
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.practical_cost_minor).toBe(4000);
  });

  it("TEST 13 — no unnecessary incentive expansion", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [pack(acceptableCheap, "ACCEPTABLE")],
        },
      ],
      vouchers: [
        {
          voucher_id: "v-thresh",
          authority: "BACKEND_DEFINED_VOUCHER",
          source_reference: "backend:voucher:thresh",
          threshold_minor: 50_000,
          discount_minor: 10_000,
          validity: "VALID",
          eligibility: "ELIGIBLE",
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.items.length).toBe(1);
    expect(result.basket.explanation.incentive.voucher_benefit_minor).toBe(0);
  });

  it("TEST 14 — deterministic output", () => {
    const input = {
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(acceptableCheap, "ACCEPTABLE"),
            pack(premiumStrong, "PREMIUM", { confidence: 0.95 }),
          ],
        },
      ],
    };
    expect(generateBestQualityBasket(input)).toEqual(
      generateBestQualityBasket(input),
    );
  });

  it("TEST 15 — budget boundary exact vs +1 paise", () => {
    const atBudget = generateBestQualityBasket({
      budget_minor: 8000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [pack(premiumStrong, "PREMIUM", { confidence: 0.95 })],
        },
      ],
    });
    expect(atBudget.feasible).toBe(true);

    const over = generateBestQualityBasket({
      budget_minor: 7999,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [pack(premiumStrong, "PREMIUM", { confidence: 0.95 })],
        },
      ],
    });
    expect(over.feasible).toBe(false);
  });

  it("TEST 16 — practical cost is optimization estimate only", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [pack(acceptableCheap, "ACCEPTABLE")],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.amount_kind).toBe("PRACTICAL_OPTIMIZATION_COST");
    expect(Object.keys(result.basket)).not.toContain("final_payable_minor");
    expect(result.basket.gross_amount_minor).toBeDefined();
    expect(result.basket.discount_amount_minor).toBeDefined();
    expect(result.basket.practical_cost_minor).toBeDefined();
  });

  it("TEST 17 — no quote / policy / payment", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [pack(acceptableCheap, "ACCEPTABLE")],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    const json = JSON.stringify(result);
    expect(Object.keys(result)).not.toContain("quote");
    expect(Object.keys(result)).not.toContain("policy_decision");
    expect(json).not.toMatch(/"ALLOW"|"DENY"/);
    expect(Object.keys(result.basket)).not.toContain("payment_amount_minor");
  });

  it("TEST 18 — Best Value vs Best Quality distinction with trade-off", () => {
    const shared = {
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(acceptableCheap, "ACCEPTABLE"),
            pack(premiumStrong, "PREMIUM", { confidence: 0.95 }),
          ],
        },
      ],
    };
    const bv = generateBestValueBasket(shared);
    const bq = generateBestQualityBasket(shared);
    expect(bv.feasible && bq.feasible).toBe(true);
    if (!bv.feasible || !bq.feasible) return;
    expect(bv.basket.practical_cost_minor).toBe(4000);
    expect(bq.basket.practical_cost_minor).toBe(8000);
    expect(bq.basket.quality_signal).toBe("PREMIUM");
    expect(bv.basket.basket_type).toBe("BEST_VALUE");
    expect(bq.basket.basket_type).toBe("BEST_QUALITY");
  });

  it("TEST 19 — same result when no meaningful trade-off", () => {
    const shared = {
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(acceptableCheap, "ACCEPTABLE"),
            pack(acceptableSame, "ACCEPTABLE"),
          ],
        },
      ],
    };
    const bv = generateBestValueBasket(shared);
    const bq = generateBestQualityBasket(shared);
    expect(bv.feasible && bq.feasible).toBe(true);
    if (!bv.feasible || !bq.feasible) return;
    expect(bv.basket.practical_cost_minor).toBe(bq.basket.practical_cost_minor);
    expect(bv.basket.practical_cost_minor).toBe(4000);
  });

  it("TEST 20 — quality evidence preserved", () => {
    const result = generateBestQualityBasket({
      budget_minor: 100_000,
      requirements: [
        {
          requirement: eggsReq,
          pack_candidates: [
            pack(premiumStrong, "PREMIUM", {
              confidence: 0.95,
              evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
            }),
          ],
        },
      ],
    });
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.basket.quality_signal).toBe("PREMIUM");
    expect(result.basket.confidence).toBe(0.95);
    expect(result.basket.evidence_refs).toContain(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
    );
    expect(result.basket.items[0]?.evidence_refs.length).toBeGreaterThan(0);
  });
});
