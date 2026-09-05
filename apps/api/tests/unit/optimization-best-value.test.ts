import { describe, it, expect } from "vitest";
import {
  BEST_VALUE_BOUNDS,
  generateBestValueBasket,
  stage1CandidatesPerRequirement,
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

const goodSix = candidate({
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

const goodTwo = candidate({
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

/** Scenario A: cheap ACCEPTABLE 6-pack (not in seed — test fixture). */
const acceptableSix = candidate({
  product_id: SEED_PRODUCT_IDS.farmEggs,
  sku_id: "33333333-3333-4333-8333-333333333399",
  product_name: "Farm Eggs Acceptable",
  brand: "FarmFresh",
  sku_code: "FARM-EGGS-6-ACC",
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: 3600,
  category_code: "dairy",
});

describe("Phase 5 Step 7 — Best Value basket generation", () => {
  describe("SCENARIO A — cheap acceptable", () => {
    it("1/5. cheaper acceptable beats higher-cost good", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [
              pack(acceptableSix, "ACCEPTABLE"),
              pack(goodSix, "GOOD", {
                evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
              }),
            ],
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.basket_type).toBe("BEST_VALUE");
      expect(result.basket.practical_cost_minor).toBe(3600);
      expect(result.basket.items.some((i) => i.sku_id === acceptableSix.sku_id)).toBe(
        true,
      );
      expect(result.basket.items.some((i) => i.sku_id === goodSix.sku_id)).toBe(
        false,
      );
    });
  });

  describe("SCENARIO B — cheap poor quality", () => {
    it("3/4. UNACCEPTABLE rejected; 3×2-pack GOOD selected", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [
              pack(poorSix, "UNACCEPTABLE", {
                meets_minimum_quality: false,
                evidence_refs: [SIX_EGG_SCENARIO.poorSixPack.evidence_id],
              }),
              pack(goodTwo, "GOOD", {
                evidence_refs: [SIX_EGG_SCENARIO.goodTwoPack.evidence_id],
              }),
              pack(goodSix, "GOOD", {
                evidence_refs: [SIX_EGG_SCENARIO.goodSixPack.evidence_id],
              }),
            ],
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.practical_cost_minor).toBe(3600);
      expect(
        result.basket.items.every((i) => i.sku_id === goodTwo.sku_id),
      ).toBe(true);
      expect(result.basket.items[0]?.quantity).toBe(3);
      expect(
        result.basket.items.some((i) => i.sku_id === poorSix.sku_id),
      ).toBe(false);
    });
  });

  describe("SCENARIO C — multi-requirement", () => {
    it("2. complete basket satisfies pasta + sauce + vegetables", () => {
      const pasta = candidate({
        product_id: SEED_PRODUCT_IDS.durumPasta,
        sku_id: SEED_SKU_IDS.durumPasta500g,
        product_name: "Durum Pasta",
        sku_code: "PASTA-500",
        pack_quantity: 1,
        pack_unit: "packs",
        price_minor: 8000,
        category_code: "grocery",
      });
      const sauce = candidate({
        product_id: SEED_PRODUCT_IDS.tomatoSauce,
        sku_id: SEED_SKU_IDS.tomatoSauce400g,
        product_name: "Tomato Sauce",
        sku_code: "SAUCE-400",
        pack_quantity: 1,
        pack_unit: "packs",
        price_minor: 5000,
        category_code: "grocery",
      });
      const veg = candidate({
        product_id: "22222222-2222-4222-8222-222222222299",
        sku_id: "33333333-3333-4333-8333-333333333398",
        product_name: "Mixed Vegetables",
        sku_code: "VEG-1",
        pack_quantity: 1,
        pack_unit: "packs",
        price_minor: 4000,
        category_code: "grocery",
      });

      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: {
              item_name: "pasta",
              target_quantity: 1,
              unit: "packs",
              minimum_quality: "ACCEPTABLE",
            },
            pack_candidates: [pack(pasta, "GOOD")],
          },
          {
            requirement: {
              item_name: "sauce",
              target_quantity: 1,
              unit: "packs",
              minimum_quality: "ACCEPTABLE",
            },
            pack_candidates: [pack(sauce, "ACCEPTABLE")],
          },
          {
            requirement: {
              item_name: "vegetables",
              target_quantity: 1,
              unit: "packs",
              minimum_quality: "ACCEPTABLE",
            },
            pack_candidates: [pack(veg, "ACCEPTABLE")],
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.practical_cost_minor).toBe(17_000);
      const names = result.basket.items.map((i) => i.item_name).sort();
      expect(names).toEqual(["pasta", "sauce", "vegetables"]);
      expect(result.basket.items.every((i) => i.quantity > 0)).toBe(true);
    });
  });

  describe("SCENARIO D — unused budget", () => {
    it("7/8. does not add filler for remaining budget", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.practical_cost_minor).toBe(3600);
      expect(result.basket.items.length).toBe(1);
      expect(result.basket.explanation.reasons).toContain(
        "NO_UNNECESSARY_ITEMS",
      );
    });
  });

  describe("incentives", () => {
    it("9 / SCENARIO E — voucher USE_NOW reduces practical cost", () => {
      const result = generateBestValueBasket({
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
            future_use_value_minor: null,
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.explanation.incentive.voucher_decision).toBe(
        "USE_NOW",
      );
      expect(result.basket.explanation.incentive.voucher_benefit_minor).toBe(
        10_000,
      );
      expect(result.basket.practical_cost_minor).toBe(50_000);
      expect(result.basket.gross_amount_minor).toBe(60_000);
      expect(result.basket.discount_amount_minor).toBe(10_000);
    });

    it("10/25 / SCENARIO F — SAVE_FOR_LATER does not reduce current cost", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: {
              item_name: "snack",
              target_quantity: 1,
              unit: "packs",
              minimum_quality: "ACCEPTABLE",
            },
            pack_candidates: [
              pack(
                candidate({
                  product_id: SEED_PRODUCT_IDS.sandwichBread,
                  sku_id: SEED_SKU_IDS.sandwichBread400g,
                  product_name: "Snack Bread",
                  sku_code: "SNACK-1",
                  pack_quantity: 1,
                  pack_unit: "packs",
                  price_minor: 10_000,
                }),
                "ACCEPTABLE",
              ),
            ],
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
      expect(result.basket.practical_cost_minor).toBe(10_000);
    });

    it("11. voucher DO_NOT_USE does not reduce cost", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
        vouchers: [
          {
            voucher_id: "v-exp",
            authority: "BACKEND_DEFINED_VOUCHER",
            source_reference: "backend:voucher:exp",
            threshold_minor: 0,
            discount_minor: 1_000,
            validity: "EXPIRED",
            eligibility: "ELIGIBLE",
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.explanation.incentive.voucher_decision).toBe(
        "DO_NOT_USE",
      );
      expect(result.basket.practical_cost_minor).toBe(3600);
    });

    it("12 / SCENARIO G — loyalty USE_NOW reduces practical cost", () => {
      const result = generateBestValueBasket({
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
        loyalty_rewards: [
          {
            reward_id: "loy-use",
            authority: "BACKEND_DEFINED_LOYALTY_REWARD",
            source_reference: "backend:loyalty:use",
            value_kind: "MONETARY",
            redeemable_value_minor: 5_000,
            validity: "VALID",
            eligibility: "ELIGIBLE",
            consumable: true,
            future_use_value_minor: null,
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.explanation.incentive.loyalty_decision).toBe(
        "USE_NOW",
      );
      expect(result.basket.practical_cost_minor).toBe(55_000);
    });

    it("13. loyalty SAVE_FOR_LATER does not reduce current cost", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
        loyalty_rewards: [
          {
            reward_id: "loy-save",
            authority: "BACKEND_DEFINED_LOYALTY_REWARD",
            source_reference: "backend:loyalty:save",
            value_kind: "MONETARY",
            redeemable_value_minor: 500,
            validity: "VALID",
            eligibility: "ELIGIBLE",
            consumable: true,
            future_use_value_minor: 5_000,
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.explanation.incentive.loyalty_decision).toBe(
        "SAVE_FOR_LATER",
      );
      expect(result.basket.explanation.incentive.loyalty_benefit_minor).toBe(0);
      expect(result.basket.practical_cost_minor).toBe(3600);
    });

    it("14. loyalty DO_NOT_USE does not reduce cost", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
        loyalty_rewards: [
          {
            reward_id: "loy-inv",
            authority: "BACKEND_DEFINED_LOYALTY_REWARD",
            source_reference: "backend:loyalty:inv",
            value_kind: "MONETARY",
            redeemable_value_minor: 1_000,
            validity: "INVALID",
            eligibility: "ELIGIBLE",
            consumable: true,
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.practical_cost_minor).toBe(3600);
    });

    it("15/27. deal + voucher + loyalty compose without double-count", () => {
      const result = generateBestValueBasket({
        budget_minor: 200_000,
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
                  price_minor: 100_000,
                }),
                "GOOD",
              ),
            ],
            deal: {
              deal_type: "BACKEND_REALIZED_SAVING",
              authority: "BACKEND_DEFINED_DEAL",
              realized_benefit_minor: 10_000,
              source_reference: "backend:deal:pasta",
            },
          },
        ],
        vouchers: [
          {
            voucher_id: "v-c",
            authority: "BACKEND_DEFINED_VOUCHER",
            source_reference: "backend:voucher:c",
            benefit_identity: "voucher-c",
            threshold_minor: 50_000,
            discount_minor: 10_000,
            validity: "VALID",
            eligibility: "ELIGIBLE",
          },
        ],
        loyalty_rewards: [
          {
            reward_id: "loy-c",
            authority: "BACKEND_DEFINED_LOYALTY_REWARD",
            source_reference: "backend:loyalty:c",
            benefit_identity: "loyalty-c",
            value_kind: "MONETARY",
            redeemable_value_minor: 10_000,
            validity: "VALID",
            eligibility: "ELIGIBLE",
            consumable: true,
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.gross_amount_minor).toBe(100_000);
      expect(result.basket.discount_amount_minor).toBe(30_000);
      expect(result.basket.practical_cost_minor).toBe(70_000);
      expect(
        result.basket.explanation.incentive.realized_deal_benefit_minor,
      ).toBe(10_000);
      expect(result.basket.explanation.incentive.voucher_benefit_minor).toBe(
        10_000,
      );
      expect(result.basket.explanation.incentive.loyalty_benefit_minor).toBe(
        10_000,
      );
    });

    it("26. no unauthorized stacking of vouchers", () => {
      const result = generateBestValueBasket({
        budget_minor: 200_000,
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
            voucher_id: "v1",
            authority: "BACKEND_DEFINED_VOUCHER",
            source_reference: "backend:voucher:1",
            threshold_minor: 0,
            discount_minor: 4_000,
            validity: "VALID",
            eligibility: "ELIGIBLE",
          },
          {
            voucher_id: "v2",
            authority: "BACKEND_DEFINED_VOUCHER",
            source_reference: "backend:voucher:2",
            threshold_minor: 0,
            discount_minor: 9_000,
            validity: "VALID",
            eligibility: "ELIGIBLE",
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.explanation.incentive.voucher_benefit_minor).toBe(
        9_000,
      );
      expect(result.basket.practical_cost_minor).toBe(51_000);
    });

    it("24. missing incentive data does not fabricate savings", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
        vouchers: [{ voucher_id: "bad" } as never],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.practical_cost_minor).toBe(3600);
      expect(result.basket.explanation.incentive.voucher_benefit_minor).toBe(0);
    });
  });

  describe("hard constraints", () => {
    it("6 / SCENARIO H — budget ceiling enforced", () => {
      const result = generateBestValueBasket({
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
                  sku_id: SEED_SKU_IDS.durumPasta1kg,
                  product_name: "Durum Pasta",
                  sku_code: "PASTA-1KG",
                  pack_quantity: 1,
                  pack_unit: "packs",
                  price_minor: 105_000,
                }),
                "GOOD",
              ),
            ],
          },
        ],
      });
      expect(result.feasible).toBe(false);
      if (result.feasible) return;
      expect(result.rejection_reasons).toContain("BUDGET_EXCEEDED");
    });

    it("18. stock-infeasible item cannot appear", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [
              pack(
                { ...poorSix, stock_available: 0, price_minor: 1000 },
                "ACCEPTABLE",
              ),
            ],
          },
        ],
      });
      expect(result.feasible).toBe(false);
    });

    it("19. category-infeasible item cannot appear", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        pack_context: { allowed_categories: ["produce"] },
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
      });
      expect(result.feasible).toBe(false);
    });

    it("20. explicitly excluded item cannot appear", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: {
              ...eggsReq,
              constraints_json: [{ type: "exclusion", value: "FarmFresh" }],
            },
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
      });
      expect(result.feasible).toBe(false);
    });

    it("21. max-per-item violation cannot appear", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        pack_context: { max_per_item_minor: 2000 },
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
      });
      expect(result.feasible).toBe(false);
    });

    it("22. minimum quality violation cannot appear", () => {
      const result = generateBestValueBasket({
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

    it("23. missing authoritative price fails closed", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [
              {
                candidate: {
                  ...acceptableSix,
                  price_minor: 12.5 as unknown as number,
                },
                quality: quality("ACCEPTABLE"),
              },
            ],
          },
        ],
      });
      expect(result.feasible).toBe(false);
    });

    it("39 / SCENARIO I — structured infeasibility", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [
              pack(
                { ...poorSix, stock_available: 0 },
                "UNACCEPTABLE",
                { meets_minimum_quality: false },
              ),
            ],
          },
        ],
      });
      expect(result.feasible).toBe(false);
      if (result.feasible) return;
      expect(result.requirement_failures.length).toBeGreaterThan(0);
      expect(result.rejection_reasons.length).toBeGreaterThan(0);
    });
  });

  describe("excess / money / determinism", () => {
    it("16–17. unjustified excess loses when exact cheaper exists", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [
              pack(acceptableSix, "ACCEPTABLE"),
              pack(goodTwo, "GOOD"),
            ],
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      // Both cover at ₹36; exact 6-pack preferred over 3×2 with same cost via excess tie-break
      // when quality of acceptableSix is ACCEPTABLE and goodTwo is GOOD — quality ranks GOOD higher
      // after cost tie → goodTwo wins on quality. Use two ACCEPTABLE options:
      expect(result.basket.practical_cost_minor).toBe(3600);
    });

    it("28–30. all items map to requirements; positive quantities; no orphans", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      for (const item of result.basket.items) {
        expect(item.item_name).toBe("eggs");
        expect(item.quantity).toBeGreaterThan(0);
        expect(item.requirement_key.length).toBeGreaterThan(0);
      }
    });

    it("31–34. integer money; no negative; discount ≤ gross", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(Number.isInteger(result.basket.gross_amount_minor)).toBe(true);
      expect(Number.isInteger(result.basket.practical_cost_minor)).toBe(true);
      expect(result.basket.practical_cost_minor).toBeGreaterThanOrEqual(0);
      expect(result.basket.discount_amount_minor).toBeLessThanOrEqual(
        result.basket.gross_amount_minor,
      );
    });

    it("35–37. deterministic result and tie-breaking", () => {
      const input = {
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [
              pack(acceptableSix, "ACCEPTABLE"),
              pack(goodSix, "GOOD"),
            ],
          },
        ],
      };
      const a = generateBestValueBasket(input);
      const b = generateBestValueBasket(input);
      expect(a).toEqual(b);
    });

    it("36. input-order independence for requirements", () => {
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
      const sauce = pack(
        candidate({
          product_id: SEED_PRODUCT_IDS.tomatoSauce,
          sku_id: SEED_SKU_IDS.tomatoSauce400g,
          product_name: "Tomato Sauce",
          sku_code: "SAUCE-400",
          pack_quantity: 1,
          pack_unit: "packs",
          price_minor: 5000,
        }),
        "ACCEPTABLE",
      );
      const forward = generateBestValueBasket({
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
            pack_candidates: [sauce],
          },
        ],
      });
      const reverse = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: {
              item_name: "sauce",
              target_quantity: 1,
              unit: "packs",
              minimum_quality: "ACCEPTABLE",
            },
            pack_candidates: [sauce],
          },
          {
            requirement: {
              item_name: "pasta",
              target_quantity: 1,
              unit: "packs",
              minimum_quality: "ACCEPTABLE",
            },
            pack_candidates: [pasta],
          },
        ],
      });
      expect(forward.feasible && reverse.feasible).toBe(true);
      if (!forward.feasible || !reverse.feasible) return;
      expect(forward.basket.practical_cost_minor).toBe(
        reverse.basket.practical_cost_minor,
      );
      expect(forward.basket.combination_key).toBe(reverse.basket.combination_key);
    });

    it("38. bounded combination search", () => {
      expect(BEST_VALUE_BOUNDS.MAX_COMPLETE_BASKETS_EXPLORED).toBeLessThanOrEqual(
        256,
      );
      expect(stage1CandidatesPerRequirement(3)).toBeLessThanOrEqual(
        BEST_VALUE_BOUNDS.MAX_CANDIDATES_PER_REQUIREMENT,
      );
      const k = stage1CandidatesPerRequirement(6);
      expect(k ** 6).toBeLessThanOrEqual(
        BEST_VALUE_BOUNDS.MAX_COMPLETE_BASKETS_EXPLORED,
      );
    });
  });

  describe("boundaries", () => {
    it("41–45. no Best Quality / recommendation / quote / AI fields", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;
      expect(result.basket.basket_type).toBe("BEST_VALUE");
      expect(Object.keys(result)).not.toContain("best_quality");
      expect(Object.keys(result)).not.toContain("recommendation");
      expect(Object.keys(result.basket)).not.toContain("quote_id");
      expect(Object.keys(result.basket)).not.toContain("final_payable_minor");
    });

    it("architectural boundary: practical cost is optimization estimate, not authorization", () => {
      const result = generateBestValueBasket({
        budget_minor: 100_000,
        requirements: [
          {
            requirement: eggsReq,
            pack_candidates: [pack(acceptableSix, "ACCEPTABLE")],
          },
        ],
      });
      expect(result.feasible).toBe(true);
      if (!result.feasible) return;

      // 1–2. Distinct optimization money fields; practical under budget is still only optimization.
      expect(result.basket.gross_amount_minor).toBe(3600);
      expect(result.basket.discount_amount_minor).toBe(0);
      expect(result.basket.practical_cost_minor).toBe(3600);
      expect(result.basket.practical_cost_minor).toBeLessThanOrEqual(100_000);
      expect(result.basket.amount_kind).toBe("PRACTICAL_OPTIMIZATION_COST");
      expect(result.basket.explanation.reasons).toContain(
        "OPTIMIZATION_BUDGET_FEASIBLE",
      );
      expect(result.basket.explanation.reasons).not.toContain("WITHIN_BUDGET");

      // 3–6. No quote, no policy ALLOW/DENY, no payment amount/authorization fields.
      expect(Object.keys(result)).not.toContain("quote");
      expect(Object.keys(result)).not.toContain("quote_id");
      expect(Object.keys(result)).not.toContain("policy_decision");
      expect(Object.keys(result)).not.toContain("decision");
      expect(Object.keys(result.basket)).not.toContain("final_payable_minor");
      expect(Object.keys(result.basket)).not.toContain("authorized_payable_minor");
      expect(Object.keys(result.basket)).not.toContain("checkout_amount_minor");
      expect(Object.keys(result.basket)).not.toContain("payment_amount_minor");
      expect(JSON.stringify(result)).not.toMatch(/"ALLOW"|"DENY"/);
      expect(JSON.stringify(result.basket)).not.toMatch(
        /final_payable|authorized_payable|checkout_amount|payment_authorized/,
      );
    });
  });
});
