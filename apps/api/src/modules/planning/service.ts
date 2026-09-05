import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { AgentService } from "../agent/index.js";
import { createRequirementExtractor } from "../requirements/create-extractor.js";
import { MandateService } from "../mandate/service.js";
import { IntentsRepository } from "../intents/repository.js";
import { SessionsRepository } from "../sessions/repository.js";
import { sessionIdSchema, userIdSchema } from "../sessions/schema.js";
import { buildSixEggsOptimizationInput } from "../optimization/demo-scenarios.js";
import {
  getEnv,
  resolvePlanningRequirementMode,
} from "../../config/env.js";
import {
  isEggGoalText,
  resolveCanonicalPlanningGoal,
} from "./canonical-goal.js";
import {
  runSessionPlanBodySchema,
  runSessionPlanDataSchema,
  type RunSessionPlanData,
} from "./schema.js";

function createPlanningAgentService(): AgentService {
  const env = getEnv();
  return new AgentService({
    extractor: createRequirementExtractor(env),
    useStubLlm: env.NODE_ENV === "test",
  });
}

/**
 * Session planning service — invokes bounded AgentService orchestration.
 * AI proposes requirements; backend assembles catalog/optimization. No payment mutation.
 */
export class PlanningService {
  constructor(
    private readonly sessionsRepository = new SessionsRepository(),
    private readonly intentsRepository = new IntentsRepository(),
    private readonly mandateService = new MandateService(),
    private readonly agentService = createPlanningAgentService(),
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

    const budgetMinor =
      intent.budget_minor === null || intent.budget_minor === undefined
        ? mandate.max_spend_minor
        : Number(intent.budget_minor);

    const mode = resolvePlanningRequirementMode();

    if (mode === "deterministic") {
      return this.runDeterministicPlan({
        userId,
        sessionId,
        intent,
        mandate,
        budgetMinor,
        requestId,
      });
    }

    return this.runLlmPlan({
      userId,
      sessionId,
      intent,
      mandate,
      budgetMinor,
      requestId,
    });
  }

  /** Explicit deterministic demo path — canonical resolver + six-egg fixtures. */
  private async runDeterministicPlan(args: {
    userId: string;
    sessionId: string;
    intent: {
      intent_id: string;
      goal_text: string;
      budget_minor: number | string | null;
    };
    mandate: {
      mandate_id: string;
      max_spend_minor: number;
      max_per_item_minor: number | null;
      allowed_categories: string[];
      currency: "INR";
    };
    budgetMinor: number;
    requestId?: string;
  }): Promise<RunSessionPlanData> {
    const canonicalGoal = resolveCanonicalPlanningGoal(args.intent.goal_text);
    if (!canonicalGoal) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          "No supported deterministic planning scenario for this goal. Try the canonical demo goal: 6 eggs.",
        statusCode: 400,
        details: { goal_text: args.intent.goal_text },
      });
    }

    const optimizationInput = isEggGoalText(canonicalGoal)
      ? buildSixEggsOptimizationInput(args.budgetMinor)
      : null;

    if (!optimizationInput) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          "No supported deterministic planning scenario for this goal. Try the canonical demo goal: 6 eggs.",
        statusCode: 400,
        details: { goal_text: args.intent.goal_text },
      });
    }

    const plan = await this.agentService.runPlanning(
      this.buildAgentRequest({
        ...args,
        goalText: canonicalGoal,
        optimizationInput,
        skipCatalogResearch: false,
      }),
    );

    return this.toPlanResponse(args.sessionId, args.intent.intent_id, plan, false);
  }

  /** Qwen requirement extraction + server-assembled optimization from catalog. */
  private async runLlmPlan(args: {
    userId: string;
    sessionId: string;
    intent: {
      intent_id: string;
      goal_text: string;
      category: string;
      budget_minor: number | string | null;
      quality_preference: string | null;
    };
    mandate: {
      mandate_id: string;
      max_spend_minor: number;
      max_per_item_minor: number | null;
      allowed_categories: string[];
      currency: "INR";
    };
    budgetMinor: number;
    requestId?: string;
  }): Promise<RunSessionPlanData> {
    const plan = await this.agentService.runPlanning(
      this.buildAgentRequest({
        userId: args.userId,
        sessionId: args.sessionId,
        intent: args.intent,
        mandate: args.mandate,
        budgetMinor: args.budgetMinor,
        requestId: args.requestId,
        goalText: args.intent.goal_text.trim(),
        optimizationInput: undefined,
        skipCatalogResearch: false,
      }),
    );

    return this.toPlanResponse(
      args.sessionId,
      args.intent.intent_id,
      plan,
      false,
    );
  }

  private buildAgentRequest(args: {
    userId: string;
    sessionId: string;
    intent: {
      intent_id: string;
      category?: string;
      quality_preference?: string | null;
    };
    mandate: {
      mandate_id: string;
      max_spend_minor: number;
      max_per_item_minor: number | null;
      allowed_categories: string[];
      currency: "INR";
    };
    budgetMinor: number;
    requestId?: string;
    goalText: string;
    optimizationInput?: ReturnType<typeof buildSixEggsOptimizationInput>;
    skipCatalogResearch: boolean;
  }) {
    const grossMinor = args.optimizationInput?.budget_minor ?? args.budgetMinor;
    return {
      agent_run_id: randomUUID(),
      request_id: args.requestId ?? randomUUID(),
      user_id: args.userId,
      session_id: args.sessionId,
      intent_id: args.intent.intent_id,
      mandate: {
        mandate_id: args.mandate.mandate_id,
        max_spend_minor: args.mandate.max_spend_minor,
        max_per_item_minor: args.mandate.max_per_item_minor ?? null,
        allowed_categories: args.mandate.allowed_categories,
        currency: args.mandate.currency,
      },
      goal: {
        goal_text: args.goalText,
        quality_preference: args.intent.quality_preference ?? null,
        budget_minor: args.budgetMinor,
        category: args.intent.category ?? "grocery",
      },
      require_policy_check: false,
      skip_catalog_research: args.skipCatalogResearch,
      optimization_input: args.optimizationInput,
      incentives: {
        basket_context: {
          gross_amount_minor: grossMinor,
          realized_deal_benefit_minor: 0,
          effective_amount_before_voucher_minor: grossMinor,
          feasible: true,
          prior_rejection_reasons: [],
          quality_signal: "GOOD",
          confidence: 0.9,
          evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02"],
        },
      },
    };
  }

  private toPlanResponse(
    sessionId: string,
    intentId: string,
    plan: Awaited<ReturnType<AgentService["runPlanning"]>>,
    catalogResearchSkipped: boolean,
  ): RunSessionPlanData {
    return parseOrThrow(runSessionPlanDataSchema, {
      session_id: sessionId,
      intent_id: intentId,
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
      catalog_research_skipped: catalogResearchSkipped,
    });
  }
}
