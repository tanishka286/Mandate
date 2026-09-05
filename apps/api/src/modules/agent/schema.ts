import { z } from "zod";
import {
  bestQualityResultSchema,
  bestValueResultSchema,
  basketRecommendationResultSchema,
  type BestValueInput,
} from "../optimization/index.js";
import {
  extractionResultSchema,
  type ExtractionResult,
} from "../requirements/extraction-schema.js";
import type { AgentEvidenceView } from "../research/evidence-trust-boundary.js";
import {
  mandateIdSchema,
  moneyMinorSchema,
  userIdSchema,
} from "../mandate/schema.js";
import { sessionIdSchema } from "../sessions/schema.js";
import { POLICY_VERSION } from "../policy/reason-codes.js";
import {
  policyEvaluateRequestSchema,
  policyReasonCodeSchema,
} from "../policy/schema.js";

/**
 * Phase 6 — Internal AI agent orchestration schemas.
 *
 * AI / LLM = untrusted proposer.
 * Domain services = authoritative state.
 * Policy = final financial authorization.
 *
 * No HTTP agent endpoints. No payment/checkout/mandate mutation tools.
 */

export const AGENT_STAGES = [
  "RECEIVED",
  "REQUIREMENTS",
  "CATALOG_RESEARCH",
  "QUALITY_RESEARCH",
  "OPTIMIZATION",
  "INCENTIVES",
  "COMPARISON",
  "RECOMMENDATION",
  "POLICY_CHECK",
  "RECOVERY",
  "COMPLETED",
  "CLARIFICATION_REQUIRED",
  "FAILED",
] as const;

export type AgentStage = (typeof AGENT_STAGES)[number];

export const agentStageSchema = z.enum(AGENT_STAGES);

/** Explicit allowlisted tool names — never expand via LLM suggestion. */
export const AGENT_TOOL_NAMES = [
  "extract_requirements",
  "search_catalog",
  "get_product",
  "get_quality_evidence",
  "run_optimization",
  "evaluate_incentives",
  "evaluate_policy",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const agentToolNameSchema = z.enum(AGENT_TOOL_NAMES);

/** Tools that must never appear in the registry (authority tests). */
export const FORBIDDEN_AGENT_TOOL_NAMES = [
  "database_query",
  "sql",
  "orm",
  "save_to_database",
  "write_database",
  "execute_sql",
  "insert_basket",
  "raw_supabase",
  "database_tool",
  "mandate_update",
  "price_update",
  "stock_update",
  "checkout",
  "razorpay",
  "payment_verification",
  "http_request",
  "code_execution",
] as const;

export type ForbiddenAgentToolName = (typeof FORBIDDEN_AGENT_TOOL_NAMES)[number];

export const agentRunIdSchema = z.string().uuid();

export const agentRequestIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "request_id must not be empty",
  });

/**
 * Read-only mandate facts captured at run start.
 * The agent may inspect these; it must never mutate them.
 */
export const agentMandateSnapshotSchema = z
  .object({
    mandate_id: mandateIdSchema,
    max_spend_minor: moneyMinorSchema,
    max_per_item_minor: moneyMinorSchema.nullable(),
    allowed_categories: z.array(z.string().min(1)),
    currency: z.literal("INR"),
  })
  .strict();

export type AgentMandateSnapshot = z.infer<typeof agentMandateSnapshotSchema>;

export const agentGoalSchema = z
  .object({
    goal_text: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "goal_text must not be empty",
      }),
    quality_preference: z.string().min(1).nullable().optional(),
    budget_minor: moneyMinorSchema.nullable().optional(),
    category: z.string().min(1).optional(),
  })
  .strict();

export type AgentGoal = z.infer<typeof agentGoalSchema>;

export const toolRequestSchema = z
  .object({
    tool: agentToolNameSchema,
    args: z.record(z.unknown()),
  })
  .strict();

export type ToolRequest = z.infer<typeof toolRequestSchema>;

export const toolResultStatusSchema = z.enum(["OK", "ERROR"]);

export const toolResultSchema = z
  .object({
    tool: agentToolNameSchema,
    status: toolResultStatusSchema,
    data: z.unknown().optional(),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ToolResult = z.infer<typeof toolResultSchema>;

/** Structured LLM recommendation / explanation — never authorization. */
export const agentRecommendationSchema = z
  .object({
    recommended_basket_type: z
      .enum(["BEST_VALUE", "BEST_QUALITY"])
      .nullable(),
    summary: z.string().min(1),
    explanation: z.string().min(1),
    tradeoffs: z.array(z.string().min(1)),
    /** Explicit: LLM explanation is not policy authorization. */
    authorization: z.literal(null),
  })
  .strict();

export type AgentRecommendation = z.infer<typeof agentRecommendationSchema>;

export const basketComparisonSchema = z
  .object({
    best_value: bestValueResultSchema.nullable(),
    best_quality: bestQualityResultSchema.nullable(),
    recommendation: basketRecommendationResultSchema,
  })
  .strict();

export type BasketComparison = z.infer<typeof basketComparisonSchema>;

export const recoveryStateSchema = z
  .object({
    attempts: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
    last_reason_code: policyReasonCodeSchema.nullable(),
    mandate_unchanged: z.literal(true),
    original_max_spend_minor: moneyMinorSchema,
  })
  .strict();

export type RecoveryState = z.infer<typeof recoveryStateSchema>;

/** Agent-facing policy ALLOW view (backend-authoritative). */
export const agentPolicyAllowViewSchema = z
  .object({
    decision: z.literal("ALLOW"),
    reason_code: z.literal("AUTHORIZED"),
    final_payable_minor: moneyMinorSchema,
    policy_version: z.literal(POLICY_VERSION),
    policy_decision_id: z.string().uuid(),
  })
  .strict();

/** Agent-facing policy DENY view (backend-authoritative). */
export const agentPolicyDenyViewSchema = z
  .object({
    decision: z.literal("DENY"),
    reason_code: policyReasonCodeSchema,
    recoverable: z.boolean(),
    details: z
      .object({
        message: z.string().nullable(),
        final_payable_minor: moneyMinorSchema,
        max_spend_minor: moneyMinorSchema,
        policy_decision_id: z.string().uuid(),
        policy_version: z.literal(POLICY_VERSION),
      })
      .strict(),
  })
  .strict();

export const agentPolicyViewSchema = z.discriminatedUnion("decision", [
  agentPolicyAllowViewSchema,
  agentPolicyDenyViewSchema,
]);

export type AgentPolicyView = z.infer<typeof agentPolicyViewSchema>;

export const persistedBasketRefSchema = z
  .object({
    basket_id: z.string().uuid(),
    basket_type: z.enum(["BEST_VALUE", "BEST_QUALITY"]),
    /** Domain content-addressed key (e.g. BEST_VALUE:<combination_key>). */
    source_basket_key: z.string().min(1),
    combination_key: z.string().nullable(),
  })
  .strict();

export type PersistedBasketRef = z.infer<typeof persistedBasketRefSchema>;

export const persistedOptimizationRefSchema = z
  .object({
    optimization_run_id: z.string().uuid(),
    session_id: sessionIdSchema,
    best_value: persistedBasketRefSchema.nullable(),
    best_quality: persistedBasketRefSchema.nullable(),
    recommendation: z
      .object({
        recommended_basket_type: z
          .enum(["BEST_VALUE", "BEST_QUALITY"])
          .nullable(),
        recommended_basket_id: z.string().uuid().nullable(),
        user_may_select_alternative: z.literal(true),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type PersistedOptimizationRef = z.infer<
  typeof persistedOptimizationRefSchema
>;

export const agentPlanningRequestSchema = z
  .object({
    agent_run_id: agentRunIdSchema,
    request_id: agentRequestIdSchema,
    /** Authenticated principal — never taken from model output. */
    user_id: userIdSchema,
    /**
     * Active shopping session owned by user_id (server context).
     * Required so successful optimization materializes UUID baskets.
     */
    session_id: sessionIdSchema,
    /** Optional intent bound to the session (server context). */
    intent_id: z.string().uuid().nullable().optional(),
    mandate: agentMandateSnapshotSchema,
    goal: agentGoalSchema,
    /**
     * When true, orchestrator requests policy evaluation after recommendation.
     * Policy remains authoritative; agent cannot override DENY.
     * Preferred Phase 7 path: materialize → USER select → fresh quote → policy HTTP.
     */
    require_policy_check: z.boolean().default(false),
    /**
     * Pre-built optimization input (catalog-assembled or test fixture).
     * Required for OPTIMIZATION stage when catalog assembly is not performed.
     */
    optimization_input: z.custom<BestValueInput>().optional(),
    /**
     * Policy evaluate request builder inputs. Lines must be sku_id + quantity only.
     * Provided by the application when require_policy_check is true.
     */
    policy_evaluate: policyEvaluateRequestSchema.optional(),
    /** Optional vouchers/loyalty for incentive stage (backend-authoritative). */
    incentives: z
      .object({
        vouchers: z.array(z.unknown()).optional(),
        loyalty_rewards: z.array(z.unknown()).optional(),
        basket_context: z.unknown().optional(),
      })
      .strict()
      .optional(),
    max_recovery_attempts: z.number().int().nonnegative().max(5).optional(),
    /** Skip catalog/evidence stages when optimization_input is supplied. */
    skip_catalog_research: z.boolean().default(false),
  })
  .strict();

export type AgentPlanningRequest = z.infer<typeof agentPlanningRequestSchema>;

export const agentRunSchema = z
  .object({
    agent_run_id: agentRunIdSchema,
    request_id: agentRequestIdSchema,
    stage: agentStageSchema,
    mandate_snapshot: agentMandateSnapshotSchema,
    session_id: sessionIdSchema,
    intent_id: z.string().uuid().nullable(),
    tool_calls: z.array(
      z
        .object({
          tool: agentToolNameSchema,
          status: toolResultStatusSchema,
        })
        .strict(),
    ),
    requirements: extractionResultSchema.nullable(),
    comparison: basketComparisonSchema.nullable(),
    recommendation: agentRecommendationSchema.nullable(),
    /**
     * Hosted-Supabase persisted UUID basket refs after materialization.
     * Null until optimization succeeds and BasketService persists.
     */
    persisted_baskets: persistedOptimizationRefSchema.nullable(),
    policy: agentPolicyViewSchema.nullable(),
    recovery: recoveryStateSchema.nullable(),
    failure: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type AgentRun = z.infer<typeof agentRunSchema>;

export const agentPlanningResultSchema = z
  .object({
    run: agentRunSchema,
    /** Structured business result — never raw LLM context. */
    outcome: z.enum([
      "COMPLETED",
      "CLARIFICATION_REQUIRED",
      "POLICY_DENIED",
      "FAILED",
    ]),
  })
  .strict();

export type AgentPlanningResult = z.infer<typeof agentPlanningResultSchema>;

/** Structured LLM synthesis payload (validated; never free-form control flow). */
export const llmRecommendationPayloadSchema = z
  .object({
    summary: z.string().min(1),
    explanation: z.string().min(1),
    tradeoffs: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type LlmRecommendationPayload = z.infer<
  typeof llmRecommendationPayloadSchema
>;

/** Opaque wrapping for untrusted free-text (evidence, descriptions, voucher meta). */
export const untrustedDataEnvelopeSchema = z
  .object({
    kind: z.literal("untrusted_data"),
    text: z.string(),
  })
  .strict();

export type UntrustedDataEnvelope = z.infer<typeof untrustedDataEnvelopeSchema>;

export type { ExtractionResult, AgentEvidenceView, BestValueInput };
