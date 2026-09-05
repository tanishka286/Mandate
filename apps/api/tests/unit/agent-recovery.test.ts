import { describe, it, expect } from "vitest";
import {
  AgentService,
  runOptimizationCore,
} from "../../src/modules/agent/index.js";
import { DeterministicRequirementExtractor } from "../../src/modules/requirements/deterministic-extractor.js";
import type { PolicyService } from "../../src/modules/policy/service.js";
import type { PolicyEvaluationResult } from "../../src/modules/policy/schema.js";
import {
  type OptimizationCandidate,
  type PackCandidateInput,
  type PackQualitySnapshot,
  type BestValueInput,
} from "../../src/modules/optimization/index.js";
import {
  SEED_PRODUCT_IDS,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";
import { loadEnv } from "../../src/config/env.js";
import {
  createStubMaterializer,
  STUB_SESSION_ID,
  STUB_BV_BASKET_ID,
  STUB_BQ_BASKET_ID,
  STUB_OPT_RUN_ID,
} from "./helpers/stub-materializer.js";

loadEnv({ NODE_ENV: "test" });

const USER_ID = "11111111-1111-4111-8111-111111111111";
const MANDATE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BASKET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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

  const pack: PackCandidateInput = {
    candidate: acceptableSix,
    quality: quality("ACCEPTABLE"),
  };

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
        pack_candidates: [pack],
      },
    ],
    budget_minor: budgetMinor,
  };
}

function policyResult(
  overrides: Partial<PolicyEvaluationResult> &
    Pick<PolicyEvaluationResult, "decision">,
): PolicyEvaluationResult {
  const base: PolicyEvaluationResult = {
    decision: overrides.decision,
    reason_code:
      overrides.decision === "ALLOW" ? null : "MAX_SPEND_EXCEEDED",
    message:
      overrides.decision === "ALLOW" ? null : "Final payable exceeds max spend",
    recoverable: overrides.decision === "DENY",
    policy_decision_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    policy_version: "policy-v1",
    mandate_id: MANDATE_ID,
    basket_id: BASKET_ID,
    gross_amount_minor: 85000,
    discount_amount_minor: 0,
    final_payable_minor: 85000,
    max_spend_minor: 80000,
    evaluated_at: "2026-09-05T00:00:00.000Z",
    request_id: "req-policy",
    ...overrides,
  };
  if (overrides.decision === "ALLOW") {
    return {
      ...base,
      reason_code: null,
      message: null,
      recoverable: false,
      final_payable_minor: overrides.final_payable_minor ?? 3600,
      gross_amount_minor: overrides.gross_amount_minor ?? 3600,
    };
  }
  return base;
}

describe("Phase 6 — optimization tool adapter", () => {
  it("reuses Phase 5 Best Value / Best Quality / recommendation", () => {
    const data = runOptimizationCore(eggsOptimizationInput(100_000));
    expect(data.best_value.feasible).toBe(true);
    expect(data.best_quality.feasible).toBe(true);
    expect(data.recommendation.feasible).toBe(true);
    expect(data.best_value_basket_id).toBeTruthy();
  });
});

describe("Phase 6 — orchestrator planning + recovery", () => {
  it("completes planning without policy when not required", async () => {
    const service = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      useStubLlm: true,
      materializer: createStubMaterializer(),
    });

    const mandate = {
      mandate_id: MANDATE_ID,
      max_spend_minor: 80_000,
      max_per_item_minor: null,
      allowed_categories: ["dairy", "grocery"],
      currency: "INR" as const,
    };

    const result = await service.runPlanning({
      agent_run_id: RUN_ID,
      request_id: "req-plan-1",
      user_id: USER_ID,
      session_id: STUB_SESSION_ID,
      mandate,
      goal: { goal_text: "6 eggs" },
      require_policy_check: false,
      skip_catalog_research: true,
      optimization_input: eggsOptimizationInput(80_000),
    });

    expect(result.outcome).toBe("COMPLETED");
    expect(result.run.stage).toBe("COMPLETED");
    expect(result.run.requirements?.status).toBe("SUCCESS");
    expect(result.run.comparison).not.toBeNull();
    expect(result.run.recommendation?.authorization).toBeNull();
    expect(result.run.mandate_snapshot.max_spend_minor).toBe(80_000);
    expect(result.run.tool_calls.some((c) => c.tool === "run_optimization")).toBe(
      true,
    );
    expect(result.run.persisted_baskets?.optimization_run_id).toBe(STUB_OPT_RUN_ID);
    expect(result.run.persisted_baskets?.best_value?.basket_id).toBe(STUB_BV_BASKET_ID);
    expect(result.run.persisted_baskets?.best_quality?.basket_id).toBe(STUB_BQ_BASKET_ID);
    expect(result.run.persisted_baskets?.best_value?.source_basket_key).toMatch(/^BEST_VALUE:/);
  });

  it("returns CLARIFICATION_REQUIRED for ambiguous goals", async () => {
    const service = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      useStubLlm: true,
      materializer: createStubMaterializer(),
    });

    const result = await service.runPlanning({
      agent_run_id: RUN_ID,
      request_id: "req-clarify",
      user_id: USER_ID,
      session_id: STUB_SESSION_ID,
      mandate: {
        mandate_id: MANDATE_ID,
        max_spend_minor: 80_000,
        max_per_item_minor: null,
        allowed_categories: ["grocery"],
        currency: "INR",
      },
      goal: { goal_text: "something nice maybe" },
      skip_catalog_research: true,
      optimization_input: eggsOptimizationInput(80_000),
    });

    expect(result.outcome).toBe("CLARIFICATION_REQUIRED");
    expect(result.run.stage).toBe("CLARIFICATION_REQUIRED");
  });

  it("DENY MAX_SPEND_EXCEEDED → recovery → policy recheck → ALLOW", async () => {
    let evaluateCount = 0;
    const policy = {
      async evaluate(): Promise<PolicyEvaluationResult> {
        evaluateCount += 1;
        if (evaluateCount === 1) {
          return policyResult({
            decision: "DENY",
            reason_code: "MAX_SPEND_EXCEEDED",
            recoverable: true,
            final_payable_minor: 85_000,
            max_spend_minor: 80_000,
          });
        }
        return policyResult({
          decision: "ALLOW",
          final_payable_minor: 3600,
          gross_amount_minor: 3600,
          max_spend_minor: 80_000,
        });
      },
    } as unknown as PolicyService;

    const service = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      policy,
      useStubLlm: true,
      materializer: createStubMaterializer(),
    });

    const mandate = {
      mandate_id: MANDATE_ID,
      max_spend_minor: 80_000,
      max_per_item_minor: 50_000,
      allowed_categories: ["dairy"],
      currency: "INR" as const,
    };

    const result = await service.runPlanning({
      agent_run_id: RUN_ID,
      request_id: "req-recover",
      user_id: USER_ID,
      session_id: STUB_SESSION_ID,
      mandate,
      goal: { goal_text: "6 eggs" },
      require_policy_check: true,
      skip_catalog_research: true,
      optimization_input: eggsOptimizationInput(100_000),
      max_recovery_attempts: 2,
      policy_evaluate: {
        user_id: USER_ID,
        mandate_id: MANDATE_ID,
        basket_id: BASKET_ID,
        request_id: "req-recover-policy",
        idempotency_key: "idem-recover",
        quote_version: "qv-1",
        lines: [
          {
            sku_id: SIX_EGG_SCENARIO.poorSixPack.sku_id,
            quantity: 1,
          },
        ],
        claimed_incentive_ids: [],
      },
    });

    expect(evaluateCount).toBe(2);
    expect(result.outcome).toBe("COMPLETED");
    expect(result.run.policy?.decision).toBe("ALLOW");
    expect(result.run.recovery?.mandate_unchanged).toBe(true);
    expect(result.run.recovery?.original_max_spend_minor).toBe(80_000);
    expect(result.run.mandate_snapshot.max_spend_minor).toBe(80_000);
    expect(result.run.mandate_snapshot.max_per_item_minor).toBe(50_000);
    expect(result.run.mandate_snapshot.allowed_categories).toEqual(["dairy"]);
    // Mandate was never expanded
    expect(mandate.max_spend_minor).toBe(80_000);
  });

  it("stops with POLICY_DENIED when recovery exhausted", async () => {
    const policy = {
      async evaluate(): Promise<PolicyEvaluationResult> {
        return policyResult({
          decision: "DENY",
          reason_code: "MAX_SPEND_EXCEEDED",
          recoverable: true,
          final_payable_minor: 85_000,
          max_spend_minor: 80_000,
        });
      },
    } as unknown as PolicyService;

    const service = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      policy,
      useStubLlm: true,
      materializer: createStubMaterializer(),
    });

    const result = await service.runPlanning({
      agent_run_id: RUN_ID,
      request_id: "req-deny",
      user_id: USER_ID,
      session_id: STUB_SESSION_ID,
      mandate: {
        mandate_id: MANDATE_ID,
        max_spend_minor: 80_000,
        max_per_item_minor: null,
        allowed_categories: ["dairy"],
        currency: "INR",
      },
      goal: { goal_text: "6 eggs" },
      require_policy_check: true,
      skip_catalog_research: true,
      optimization_input: eggsOptimizationInput(100_000),
      max_recovery_attempts: 1,
      policy_evaluate: {
        user_id: USER_ID,
        mandate_id: MANDATE_ID,
        basket_id: BASKET_ID,
        request_id: "req-deny-policy",
        idempotency_key: "idem-deny",
        quote_version: "qv-1",
        lines: [
          {
            sku_id: SIX_EGG_SCENARIO.poorSixPack.sku_id,
            quantity: 1,
          },
        ],
        claimed_incentive_ids: [],
      },
    });

    expect(result.outcome).toBe("POLICY_DENIED");
    expect(result.run.policy?.decision).toBe("DENY");
    if (result.run.policy?.decision === "DENY") {
      expect(result.run.policy.recoverable).toBe(true);
      expect(result.run.policy.reason_code).toBe("MAX_SPEND_EXCEEDED");
    }
    expect(result.run.recovery?.mandate_unchanged).toBe(true);
  });

  it("does not convert non-recoverable DENY into ALLOW", async () => {
    const policy = {
      async evaluate(): Promise<PolicyEvaluationResult> {
        return policyResult({
          decision: "DENY",
          reason_code: "MANDATE_INVALID",
          recoverable: false,
          message: "invalid",
        });
      },
    } as unknown as PolicyService;

    const service = new AgentService({
      policy,
      useStubLlm: true,
      materializer: createStubMaterializer(),
    });

    const result = await service.runPlanning({
      agent_run_id: RUN_ID,
      request_id: "req-hard-deny",
      user_id: USER_ID,
      session_id: STUB_SESSION_ID,
      mandate: {
        mandate_id: MANDATE_ID,
        max_spend_minor: 80_000,
        max_per_item_minor: null,
        allowed_categories: ["dairy"],
        currency: "INR",
      },
      goal: { goal_text: "6 eggs" },
      require_policy_check: true,
      skip_catalog_research: true,
      optimization_input: eggsOptimizationInput(80_000),
      max_recovery_attempts: 3,
      policy_evaluate: {
        user_id: USER_ID,
        mandate_id: MANDATE_ID,
        basket_id: BASKET_ID,
        request_id: "req-hard",
        idempotency_key: "idem-hard",
        quote_version: "qv-1",
        lines: [
          {
            sku_id: SIX_EGG_SCENARIO.poorSixPack.sku_id,
            quantity: 1,
          },
        ],
        claimed_incentive_ids: [],
      },
    });

    expect(result.outcome).toBe("POLICY_DENIED");
    expect(result.run.policy?.decision).toBe("DENY");
    // No recovery attempts for non-recoverable
    expect(result.run.recovery).toBeNull();
  });
});
