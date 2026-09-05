import { describe, it, expect } from "vitest";
import {
  AgentService,
  buildMaterializeInputFromOptimization,
  runOptimizationCore,
  FORBIDDEN_AGENT_TOOL_NAMES,
  createAllowlistedToolRegistry,
} from "../../src/modules/agent/index.js";
import { DeterministicRequirementExtractor } from "../../src/modules/requirements/deterministic-extractor.js";
import {
  type OptimizationCandidate,
  type PackCandidateInput,
  type PackQualitySnapshot,
  type BestValueInput,
} from "../../src/modules/optimization/index.js";
import {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";
import { loadEnv } from "../../src/config/env.js";
import {
  createStubMaterializer,
  STUB_SESSION_ID,
  STUB_BV_BASKET_ID,
  STUB_BQ_BASKET_ID,
} from "./helpers/stub-materializer.js";

loadEnv({ NODE_ENV: "test" });

const USER_ID = "11111111-1111-4111-8111-111111111111";
const MANDATE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function quality(
  signal: PackQualitySnapshot["quality_signal"],
): PackQualitySnapshot {
  return {
    quality_signal: signal,
    confidence: 0.9,
    evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01"],
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

function eggsOptimizationInput(budgetMinor: number): BestValueInput {
  const acceptableSix = candidate({
    product_id: SEED_PRODUCT_IDS.selectEggs,
    sku_id: SEED_SKU_IDS.selectEggs6,
    product_name: "Select Eggs",
    brand: "SelectFarm",
    sku_code: SIX_EGG_SCENARIO.goodSixPack.sku_code,
    pack_quantity: 6,
    pack_unit: "pieces",
    price_minor: SIX_EGG_SCENARIO.goodSixPack.price_minor,
    category_code: "dairy",
  });
  const poorSix = candidate({
    product_id: SEED_PRODUCT_IDS.farmEggs,
    sku_id: SEED_SKU_IDS.farmEggs6,
    product_name: "Farm Eggs",
    brand: "FarmFresh",
    sku_code: SIX_EGG_SCENARIO.poorSixPack.sku_code,
    pack_quantity: 6,
    pack_unit: "pieces",
    price_minor: SIX_EGG_SCENARIO.poorSixPack.price_minor,
    category_code: "dairy",
  });
  const goodTwo = candidate({
    product_id: SEED_PRODUCT_IDS.farmEggs,
    sku_id: SEED_SKU_IDS.farmEggs2,
    product_name: "Farm Eggs 2",
    brand: "FarmFresh",
    sku_code: SIX_EGG_SCENARIO.goodTwoPack.sku_code,
    pack_quantity: 2,
    pack_unit: "pieces",
    price_minor: SIX_EGG_SCENARIO.goodTwoPack.price_minor,
    category_code: "dairy",
  });

  const packs: PackCandidateInput[] = [
    { candidate: poorSix, quality: quality("UNACCEPTABLE") },
    { candidate: acceptableSix, quality: quality("GOOD") },
    { candidate: goodTwo, quality: quality("GOOD") },
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

describe("Phase 6 → Phase 7 seam — materialization wiring", () => {
  it("maps both feasible baskets without treating practical cost as checkout", () => {
    const optimization = runOptimizationCore(eggsOptimizationInput(100_000));
    expect(optimization.best_value.feasible).toBe(true);
    expect(optimization.best_quality.feasible).toBe(true);

    const input = buildMaterializeInputFromOptimization({
      session_id: STUB_SESSION_ID,
      mandate_id: MANDATE_ID,
      optimization,
    });

    expect(input.best_value).toBeTruthy();
    expect(input.best_quality).toBeTruthy();
    expect(input.best_value?.basket_type).toBe("BEST_VALUE");
    expect(input.best_quality?.basket_type).toBe("BEST_QUALITY");
    expect(input.best_value?.combination_key).toBeTruthy();
    // final_payable_minor must not be copied from practical_cost
    expect(input.best_value).not.toHaveProperty("final_payable_minor");
    expect(
      (optimization.best_value.feasible === true
        ? optimization.best_value.basket.amount_kind
        : null) === "PRACTICAL_OPTIMIZATION_COST",
    ).toBe(true);
  });

  it("orchestrator materializes both baskets via BasketService port", async () => {
    let calls = 0;
    const materializer = createStubMaterializer({
      onCall: (userId, input) => {
        calls += 1;
        expect(userId).toBe(USER_ID);
        expect(input.session_id).toBe(STUB_SESSION_ID);
        expect(input.mandate_id).toBe(MANDATE_ID);
        expect(input.best_value).toBeTruthy();
        expect(input.best_quality).toBeTruthy();
      },
    });

    const service = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      useStubLlm: true,
      materializer,
    });

    const result = await service.runPlanning({
      agent_run_id: RUN_ID,
      request_id: "req-seam-1",
      user_id: USER_ID,
      session_id: STUB_SESSION_ID,
      mandate: {
        mandate_id: MANDATE_ID,
        max_spend_minor: 100_000,
        max_per_item_minor: null,
        allowed_categories: ["dairy", "grocery"],
        currency: "INR",
      },
      goal: { goal_text: "6 eggs" },
      require_policy_check: false,
      skip_catalog_research: true,
      optimization_input: eggsOptimizationInput(100_000),
    });

    expect(calls).toBe(1);
    expect(result.outcome).toBe("COMPLETED");
    expect(result.run.persisted_baskets?.best_value?.basket_id).toBe(
      STUB_BV_BASKET_ID,
    );
    expect(result.run.persisted_baskets?.best_quality?.basket_id).toBe(
      STUB_BQ_BASKET_ID,
    );
    expect(result.run.persisted_baskets?.best_value?.source_basket_key).toMatch(
      /^BEST_VALUE:/,
    );
    expect(
      result.run.persisted_baskets?.recommendation?.user_may_select_alternative,
    ).toBe(true);
  });

  it("does not invent persisted baskets when materialization fails", async () => {
    const service = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      useStubLlm: true,
      materializer: createStubMaterializer({ fail: true }),
    });

    const result = await service.runPlanning({
      agent_run_id: RUN_ID,
      request_id: "req-seam-fail",
      user_id: USER_ID,
      session_id: STUB_SESSION_ID,
      mandate: {
        mandate_id: MANDATE_ID,
        max_spend_minor: 100_000,
        max_per_item_minor: null,
        allowed_categories: ["dairy"],
        currency: "INR",
      },
      goal: { goal_text: "6 eggs" },
      require_policy_check: false,
      skip_catalog_research: true,
      optimization_input: eggsOptimizationInput(100_000),
    });

    expect(result.outcome).toBe("FAILED");
    expect(result.run.persisted_baskets).toBeNull();
    expect(result.run.failure?.code).toBe("BASKET_MATERIALIZATION_FAILED");
  });

  it("does not register database write tools for the agent", () => {
    const listed = createAllowlistedToolRegistry().list();
    for (const name of [
      "save_to_database",
      "write_database",
      "execute_sql",
      "insert_basket",
      "raw_supabase",
      "database_tool",
      ...FORBIDDEN_AGENT_TOOL_NAMES,
    ]) {
      expect(listed).not.toContain(name);
    }
  });
});
