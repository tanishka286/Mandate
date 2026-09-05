/**
 * Phase 6 — Internal AI agent orchestration module.
 *
 * Not an HTTP surface. No POST /agent/plan.
 * Tools are allowlisted adapters over existing domain services.
 * Basket materialization is orchestration → BasketService (not an AI tool).
 */

export { AgentService, createAllowlistedToolRegistry } from "./service.js";
export type { AgentServiceOptions } from "./service.js";

export { AgentOrchestrator } from "./orchestrator.js";
export type { AgentOrchestratorDeps } from "./orchestrator.js";

export {
  OllamaStructuredLlmProvider,
  StubStructuredLlmProvider,
} from "./ai-adapter.js";
export type { StructuredLlmProvider } from "./ai-adapter.js";

export {
  AgentToolRegistry,
  assertAllowlistedOnly,
} from "./tools/registry.js";
export type {
  AgentToolHandler,
  AgentToolContext,
} from "./tools/registry.js";

export { extractRequirementsTool } from "./tools/requirements-tool.js";
export { searchCatalogTool, getProductTool } from "./tools/catalog-tool.js";
export {
  getQualityEvidenceTool,
  isolateUntrustedEvidenceText,
} from "./tools/evidence-tool.js";
export {
  runOptimizationTool,
  runOptimizationCore,
} from "./tools/optimization-tool.js";
export {
  evaluateIncentivesTool,
  isolateVoucherMetadata,
} from "./tools/incentive-tool.js";
export {
  evaluatePolicyTool,
  toAgentPolicyView,
  refusePolicyOverride,
} from "./tools/policy-tool.js";

export {
  buildMaterializeInputFromOptimization,
  toPersistedOptimizationRef,
  sourceBasketKeyFor,
} from "./materialize-from-optimization.js";
export type { OptimizationMaterializer } from "./materialize-from-optimization.js";

export {
  AGENT_STAGES,
  AGENT_TOOL_NAMES,
  FORBIDDEN_AGENT_TOOL_NAMES,
  agentStageSchema,
  agentToolNameSchema,
  agentRunIdSchema,
  agentMandateSnapshotSchema,
  agentGoalSchema,
  toolRequestSchema,
  toolResultSchema,
  agentRecommendationSchema,
  basketComparisonSchema,
  recoveryStateSchema,
  agentPolicyAllowViewSchema,
  agentPolicyDenyViewSchema,
  agentPolicyViewSchema,
  agentPlanningRequestSchema,
  agentRunSchema,
  agentPlanningResultSchema,
  llmRecommendationPayloadSchema,
  untrustedDataEnvelopeSchema,
  persistedBasketRefSchema,
  persistedOptimizationRefSchema,
} from "./schema.js";

export type {
  AgentStage,
  AgentToolName,
  ForbiddenAgentToolName,
  AgentMandateSnapshot,
  AgentGoal,
  ToolRequest,
  ToolResult,
  AgentRecommendation,
  BasketComparison,
  RecoveryState,
  AgentPolicyView,
  AgentPlanningRequest,
  AgentRun,
  AgentPlanningResult,
  LlmRecommendationPayload,
  UntrustedDataEnvelope,
  PersistedBasketRef,
  PersistedOptimizationRef,
} from "./schema.js";
