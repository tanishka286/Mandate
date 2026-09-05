/**
 * Agent module public types — re-export from schema (Zod-inferred).
 */

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
  ExtractionResult,
  AgentEvidenceView,
  BestValueInput,
} from "./schema.js";

export type {
  AgentToolHandler,
  AgentToolRegistry,
  AgentToolContext,
} from "./tools/registry.js";

export type { StructuredLlmProvider } from "./ai-adapter.js";
