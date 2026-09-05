import type {
  BestValueInput,
  OptimizationCandidate,
  PackCandidateInput,
  PackQualitySnapshot,
} from "./index.js";
import {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
  SIX_EGG_SCENARIO,
} from "../research/seed-fixtures.js";

function quality(
  signal: PackQualitySnapshot["quality_signal"],
): PackQualitySnapshot {
  return {
    quality_signal: signal,
    confidence: 0.9,
    evidence_refs: [SIX_EGG_SCENARIO.goodTwoPack.evidence_id],
    evidence_status: signal === null ? "NONE" : "SUFFICIENT",
    meets_minimum_quality:
      signal === null ? false : signal !== "UNACCEPTABLE",
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

/**
 * Canonical six-egg optimization input for demo/E2E hosted fixtures.
 * Pack candidates mirror seeded catalog + quality evidence — not client authority.
 */
export function buildSixEggsOptimizationInput(
  budgetMinor = 100_000,
  options?: { selectSixPackQuality?: PackQualitySnapshot["quality_signal"] },
): BestValueInput {
  const selectQuality = options?.selectSixPackQuality ?? "GOOD";
  const packs: PackCandidateInput[] = [
    {
      candidate: candidate({
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_id: SEED_SKU_IDS.farmEggs6,
        product_name: "Farm Eggs 6",
        sku_code: SIX_EGG_SCENARIO.poorSixPack.sku_code,
        pack_quantity: 6,
        price_minor: SIX_EGG_SCENARIO.poorSixPack.price_minor,
      }),
      quality: quality("UNACCEPTABLE"),
    },
    {
      candidate: candidate({
        product_id: SEED_PRODUCT_IDS.selectEggs,
        sku_id: SEED_SKU_IDS.selectEggs6,
        product_name: "Select Eggs 6",
        sku_code: SIX_EGG_SCENARIO.goodSixPack.sku_code,
        pack_quantity: 6,
        price_minor: SIX_EGG_SCENARIO.goodSixPack.price_minor,
      }),
      quality: quality(selectQuality),
    },
    {
      candidate: candidate({
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_id: SEED_SKU_IDS.farmEggs2,
        product_name: "Farm Eggs 2",
        sku_code: SIX_EGG_SCENARIO.goodTwoPack.sku_code,
        pack_quantity: 2,
        price_minor: SIX_EGG_SCENARIO.goodTwoPack.price_minor,
      }),
      quality: quality("GOOD"),
    },
  ];

  return {
    requirements: [
      {
        requirement: {
          item_name: "eggs",
          target_quantity: 6,
          unit: "pieces",
          minimum_quality: "ACCEPTABLE",
          constraints_json: [],
        },
        pack_candidates: packs,
      },
    ],
    budget_minor: budgetMinor,
  };
}
