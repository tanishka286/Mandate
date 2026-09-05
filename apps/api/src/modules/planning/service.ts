import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { AgentService } from "../agent/index.js";
import { DeterministicRequirementExtractor } from "../requirements/deterministic-extractor.js";
import { MandateService } from "../mandate/service.js";
import { IntentsRepository } from "../intents/repository.js";
import { SessionsRepository } from "../sessions/repository.js";
import { sessionIdSchema, userIdSchema } from "../sessions/schema.js";
import { buildSixEggsOptimizationInput } from "../optimization/demo-scenarios.js";
import {
  runSessionPlanBodySchema,
  runSessionPlanDataSchema,
  type RunSessionPlanData,
} from "./schema.js";

const EGG_GOAL_PATTERN = /\beggs?\b/i;

/**
 * Session planning service — invokes bounded AgentService orchestration.
 * AI reasons; backend persists baskets. No payment or mandate mutation.
 */
export class PlanningService {
  constructor(
    private readonly sessionsRepository = new SessionsRepository(),
    private readonly intentsRepository = new IntentsRepository(),
    private readonly mandateService = new MandateService(),
    private readonly agentService = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      useStubLlm: true,
    }),
  ) {}

  async runSessionPlan(
    userId: string,
    sessionId: string,
    body: unknown,
    requestId?: string,
  ): Promise<RunSessionPlanData> {
    parseOrThrow(userIdSchema, userId);
    parseOrThrow(sessionIdSchema, sessionId);
    const input = parseOrThrow(runSessionPlanBodySchema, body);

    const session = await this.sessionsRepository.findById(sessionId);
    if (!session) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Shopping session not found",
        statusCode: 404,
        details: { session_id: sessionId },
      });
    }
    if (session.user_id !== userId) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Shopping session does not belong to the authenticated user",
        statusCode: 403,
        details: { session_id: sessionId },
      });
    }
    if (session.status !== "ACTIVE") {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: "Shopping session is not ACTIVE",
        statusCode: 409,
        details: { session_id: sessionId, status: session.status },
      });
    }

    const intent = await this.intentsRepository.findById(input.intent_id);
    if (!intent || intent.session_id !== sessionId) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Shopping intent not found for session",
        statusCode: 404,
        details: { intent_id: input.intent_id, session_id: sessionId },
      });
    }

    const mandate = await this.mandateService.requireValidMandateForAuthorization(
      userId,
      intent.mandate_id,
    );

    const optimizationInput = this.resolveOptimizationInput(intent.goal_text, {
      budget_minor:
        intent.budget_minor === null || intent.budget_minor === undefined
          ? mandate.max_spend_minor
          : Number(intent.budget_minor),
    });

    const skipCatalogResearch = optimizationInput === null;
    if (!optimizationInput) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          "No supported deterministic planning scenario for this goal. Try the canonical demo goal: 6 eggs.",
        statusCode: 400,
        details: { goal_text: intent.goal_text },
      });
    }

    const plan = await this.agentService.runPlanning({
      agent_run_id: randomUUID(),
      request_id: requestId ?? randomUUID(),
      user_id: userId,
      session_id: sessionId,
      intent_id: intent.intent_id,
      mandate: {
        mandate_id: mandate.mandate_id,
        max_spend_minor: mandate.max_spend_minor,
        max_per_item_minor: mandate.max_per_item_minor ?? null,
        allowed_categories: mandate.allowed_categories,
        currency: mandate.currency,
      },
      goal: { goal_text: intent.goal_text },
      require_policy_check: false,
      skip_catalog_research: skipCatalogResearch,
      optimization_input: optimizationInput,
      incentives: {
        basket_context: {
          gross_amount_minor: optimizationInput.budget_minor ?? mandate.max_spend_minor,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor:
            optimizationInput.budget_minor ?? mandate.max_spend_minor,
          feasible: true,
          prior_rejection_reasons: [],
          quality_signal: "GOOD",
          confidence: 0.9,
          evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02"],
        },
      },
    });

    return parseOrThrow(runSessionPlanDataSchema, {
      session_id: sessionId,
      intent_id: intent.intent_id,
      outcome: plan.outcome,
      optimization_run_id:
        plan.run.persisted_baskets?.optimization_run_id ?? null,
      best_value_basket_id:
        plan.run.persisted_baskets?.best_value?.basket_id ?? null,
      best_quality_basket_id:
        plan.run.persisted_baskets?.best_quality?.basket_id ?? null,
      recommended_basket_type:
        plan.run.persisted_baskets?.recommendation?.recommended_basket_type ??
        null,
      catalog_research_skipped: skipCatalogResearch,
    });
  }

  private resolveOptimizationInput(
    goalText: string,
    options: { budget_minor: number },
  ) {
    if (EGG_GOAL_PATTERN.test(goalText)) {
      return buildSixEggsOptimizationInput(options.budget_minor);
    }
    return null;
  }
}
