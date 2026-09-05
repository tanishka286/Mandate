import { CatalogService } from "../catalog/service.js";
import { createRequirementExtractor } from "../requirements/create-extractor.js";
import type { RequirementExtractor } from "../requirements/extractor.js";
import { ResearchService } from "../research/service.js";
import { PolicyService } from "../policy/service.js";
import { BasketService } from "../basket/service.js";
import { getEnv } from "../../config/env.js";
import {
  OllamaStructuredLlmProvider,
  StubStructuredLlmProvider,
  type StructuredLlmProvider,
} from "./ai-adapter.js";
import { AgentOrchestrator } from "./orchestrator.js";
import type { AgentPlanningResult } from "./schema.js";
import {
  AgentToolRegistry,
  type AgentToolContext,
} from "./tools/registry.js";
import { extractRequirementsTool } from "./tools/requirements-tool.js";
import {
  searchCatalogTool,
  getProductTool,
} from "./tools/catalog-tool.js";
import { getQualityEvidenceTool } from "./tools/evidence-tool.js";
import { runOptimizationTool } from "./tools/optimization-tool.js";
import { evaluateIncentivesTool } from "./tools/incentive-tool.js";
import { evaluatePolicyTool } from "./tools/policy-tool.js";
import type { OptimizationMaterializer } from "./materialize-from-optimization.js";

/**
 * AgentService — internal application entry for Phase 6 orchestration.
 *
 * No HTTP router. Callers invoke runPlanning() in-process.
 * Successful optimization is materialized via BasketService (hosted Supabase).
 * Stops before payment / checkout. Selection remains a separate Phase 7 step.
 */

export function createAllowlistedToolRegistry(): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  registry.register("extract_requirements", extractRequirementsTool);
  registry.register("search_catalog", searchCatalogTool);
  registry.register("get_product", getProductTool);
  registry.register("get_quality_evidence", getQualityEvidenceTool);
  registry.register("run_optimization", runOptimizationTool);
  registry.register("evaluate_incentives", evaluateIncentivesTool);
  registry.register("evaluate_policy", evaluatePolicyTool);
  return registry;
}

export type AgentServiceOptions = {
  extractor?: RequirementExtractor;
  catalog?: CatalogService;
  research?: ResearchService;
  policy?: PolicyService;
  llm?: StructuredLlmProvider;
  registry?: AgentToolRegistry;
  /**
   * Basket persistence port. Defaults to BasketService (hosted Supabase).
   * Unit tests inject a stub — never an AI database tool.
   */
  materializer?: OptimizationMaterializer;
  /** Use stub LLM (no network). Default true in test NODE_ENV. */
  useStubLlm?: boolean;
};

export class AgentService {
  private readonly orchestrator: AgentOrchestrator;
  private readonly registry: AgentToolRegistry;
  private readonly context: AgentToolContext;

  constructor(options: AgentServiceOptions = {}) {
    const env = getEnv();
    const useStub =
      options.llm != null
        ? false
        : (options.useStubLlm ?? env.NODE_ENV === "test");

    const llm =
      options.llm ??
      (useStub
        ? new StubStructuredLlmProvider()
        : new OllamaStructuredLlmProvider());

    this.registry = options.registry ?? createAllowlistedToolRegistry();
    this.context = {
      extractor:
        options.extractor ?? createRequirementExtractor(env),
      catalog: options.catalog ?? new CatalogService(),
      research: options.research ?? new ResearchService(),
      policy: options.policy ?? new PolicyService(),
      llm,
    };

    const materializer = options.materializer ?? new BasketService();

    this.orchestrator = new AgentOrchestrator({
      registry: this.registry,
      context: this.context,
      llm,
      materializer,
    });
  }

  /** Allowlisted tool names currently registered. */
  listTools(): readonly string[] {
    return this.registry.list();
  }

  /**
   * Attempt to invoke a tool by name (tests / internal only).
   * Forbidden and non-allowlisted names are rejected by the registry.
   */
  async invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return this.registry.invoke(name, args, this.context);
  }

  /**
   * Run bounded planning orchestration.
   * Materializes optimization baskets via BasketService after success.
   * Does not create payment orders, mutate mandates, or expose DB tools.
   */
  async runPlanning(request: unknown): Promise<AgentPlanningResult> {
    return this.orchestrator.run(request);
  }
}
