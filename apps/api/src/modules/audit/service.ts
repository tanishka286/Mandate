import { logger } from "../../shared/logger/index.js";
import { sanitizeAuditEventData } from "./sanitize.js";
import { AuditRepository } from "./repository.js";
import type {
  AuditCorrelationContext,
  AuditEventType,
  PaymentVerificationAuditContext,
  RecordAuditEventInput,
  SessionAuditTrailData,
  WebhookAuditContext,
  WorkflowAuditContext,
} from "./types.js";

function withRequestId(
  context: AuditCorrelationContext,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data };
  if ("request_id" in context && context.request_id) {
    payload.request_id = context.request_id;
  }
  return sanitizeAuditEventData(payload);
}

function correlationFields(
  context: AuditCorrelationContext,
): Pick<
  RecordAuditEventInput,
  | "user_id"
  | "session_id"
  | "agent_run_id"
  | "mandate_id"
  | "optimization_run_id"
  | "basket_id"
  | "policy_decision_id"
  | "order_id"
  | "payment_id"
> {
  return {
    user_id: context.user_id ?? null,
    session_id: context.session_id ?? null,
    agent_run_id: context.agent_run_id ?? null,
    mandate_id: context.mandate_id ?? null,
    optimization_run_id: context.optimization_run_id ?? null,
    basket_id: context.basket_id ?? null,
    policy_decision_id: context.policy_decision_id ?? null,
    order_id: context.order_id ?? null,
    payment_id: context.payment_id ?? null,
  };
}

/**
 * Audit service — Phase 9 workflow + Phase 8 payment/webhook events.
 * Audit write failures must not affect commerce or payment outcomes.
 */
export class AuditService {
  constructor(private readonly repository = new AuditRepository()) {}

  async getSessionAuditTrail(
    userId: string,
    sessionId: string,
    sessionOwnerId: string,
  ): Promise<SessionAuditTrailData> {
    if (sessionOwnerId !== userId) {
      throw new Error("Session ownership check must be performed by caller");
    }

    const events = await this.repository.listBySessionId(sessionId);
    return {
      session_id: sessionId,
      events: events.filter(
        (event) => event.user_id === null || event.user_id === userId,
      ),
    };
  }

  async recordEvent(
    context: WorkflowAuditContext,
    eventType: AuditEventType,
    data: Record<string, unknown>,
    occurredAt?: string,
  ): Promise<void> {
    await this.safeRecord({
      event_type: eventType,
      ...correlationFields(context),
      event_data_json: withRequestId(context, data),
      occurred_at: occurredAt,
    });
  }

  async recordIntentReceived(
    context: WorkflowAuditContext,
    data: {
      intent_id: string;
      goal_category: string;
      budget_minor?: number | null;
    },
  ): Promise<void> {
    await this.recordEvent(context, "INTENT_RECEIVED", {
      intent_id: data.intent_id,
      goal_category: data.goal_category,
      ...(data.budget_minor != null
        ? { budget_minor: data.budget_minor }
        : {}),
    });
  }

  async recordRequirementsCreated(
    context: WorkflowAuditContext,
    data: {
      intent_id: string;
      requirement_ids: string[];
      assumptions?: unknown[];
    },
  ): Promise<void> {
    await this.recordEvent(context, "REQUIREMENTS_CREATED", {
      intent_id: data.intent_id,
      requirement_ids: data.requirement_ids,
      ...(data.assumptions?.length
        ? { assumptions: data.assumptions }
        : {}),
    });
  }

  async recordProductResearched(
    context: WorkflowAuditContext,
    data: {
      product_id: string;
      sku_id?: string | null;
      evidence_ids: string[];
      quality_signal?: string | null;
      confidence?: number | null;
      source_type?: string | null;
    },
  ): Promise<void> {
    await this.recordEvent(context, "PRODUCT_RESEARCHED", {
      product_id: data.product_id,
      ...(data.sku_id ? { sku_id: data.sku_id } : {}),
      evidence_ids: data.evidence_ids,
      ...(data.quality_signal != null
        ? { quality_signal: data.quality_signal }
        : {}),
      ...(data.confidence != null ? { confidence: data.confidence } : {}),
      ...(data.source_type ? { source_type: data.source_type } : {}),
    });
  }

  async recordBasketCreated(
    context: WorkflowAuditContext,
    data: {
      basket_id: string;
      basket_type: string;
      gross_amount_minor: number;
      discount_amount_minor: number;
      final_payable_minor: number;
      requirement_refs?: string[];
    },
  ): Promise<void> {
    await this.recordEvent(context, "BASKET_CREATED", {
      basket_id: data.basket_id,
      basket_type: data.basket_type,
      gross_amount_minor: data.gross_amount_minor,
      discount_amount_minor: data.discount_amount_minor,
      final_payable_minor: data.final_payable_minor,
      ...(data.requirement_refs?.length
        ? { requirement_refs: data.requirement_refs }
        : {}),
    });
  }

  async recordVoucherEvaluated(
    context: WorkflowAuditContext,
    data: {
      incentive_id: string;
      basket_id?: string | null;
      decision: string;
      actual_saving_minor?: number | null;
      future_value_minor?: number | null;
      reason?: string | null;
    },
  ): Promise<void> {
    await this.recordEvent(context, "VOUCHER_EVALUATED", {
      incentive_id: data.incentive_id,
      ...(data.basket_id ? { basket_id: data.basket_id } : {}),
      decision: data.decision,
      ...(data.actual_saving_minor != null
        ? { actual_saving_minor: data.actual_saving_minor }
        : {}),
      ...(data.future_value_minor != null
        ? { future_value_minor: data.future_value_minor }
        : {}),
      ...(data.reason ? { reason: data.reason } : {}),
    });
  }

  async recordLoyaltyEvaluated(
    context: WorkflowAuditContext,
    data: {
      incentive_id: string;
      basket_id?: string | null;
      decision: string;
      actual_saving_minor?: number | null;
      future_value_minor?: number | null;
      reason?: string | null;
    },
  ): Promise<void> {
    await this.recordEvent(context, "LOYALTY_EVALUATED", {
      incentive_id: data.incentive_id,
      ...(data.basket_id ? { basket_id: data.basket_id } : {}),
      decision: data.decision,
      ...(data.actual_saving_minor != null
        ? { actual_saving_minor: data.actual_saving_minor }
        : {}),
      ...(data.future_value_minor != null
        ? { future_value_minor: data.future_value_minor }
        : {}),
      ...(data.reason ? { reason: data.reason } : {}),
    });
  }

  async recordBasketRecommended(
    context: WorkflowAuditContext,
    data: {
      recommended_basket_id?: string | null;
      recommended_basket_type?: string | null;
      reason?: string | null;
      tradeoff_summary?: string | null;
    },
  ): Promise<void> {
    await this.recordEvent(context, "BASKET_RECOMMENDED", {
      ...(data.recommended_basket_id
        ? { recommended_basket_id: data.recommended_basket_id }
        : {}),
      ...(data.recommended_basket_type
        ? { recommended_basket_type: data.recommended_basket_type }
        : {}),
      ...(data.reason ? { reason: data.reason } : {}),
      ...(data.tradeoff_summary
        ? { tradeoff_summary: data.tradeoff_summary }
        : {}),
    });
  }

  async recordBasketSelected(
    context: WorkflowAuditContext,
    data: {
      selection_id: string;
      basket_id: string;
      selection_source: string;
    },
  ): Promise<void> {
    await this.recordEvent(context, "BASKET_SELECTED", {
      selection_id: data.selection_id,
      basket_id: data.basket_id,
      selection_source: data.selection_source,
    });
  }

  async recordFreshQuote(
    context: WorkflowAuditContext,
    data: {
      basket_id: string;
      quote_version: string;
      gross_amount_minor: number;
      discount_amount_minor: number;
      final_payable_minor: number;
      basket_state_version: number;
      selection_id?: string | null;
    },
  ): Promise<void> {
    await this.recordEvent(context, "FRESH_QUOTE", {
      basket_id: data.basket_id,
      quote_version: data.quote_version,
      gross_amount_minor: data.gross_amount_minor,
      discount_amount_minor: data.discount_amount_minor,
      final_payable_minor: data.final_payable_minor,
      basket_state_version: data.basket_state_version,
      ...(data.selection_id ? { selection_id: data.selection_id } : {}),
    });
  }

  async recordPolicyDecision(
    context: WorkflowAuditContext,
    data: {
      policy_decision_id: string;
      decision: "ALLOW" | "DENY";
      reason_code?: string | null;
      gross_amount_minor: number;
      discount_amount_minor: number;
      final_payable_minor: number;
      max_spend_minor: number;
      policy_version: string;
      evaluated_at: string;
    },
  ): Promise<void> {
    const eventType = data.decision === "ALLOW" ? "POLICY_ALLOW" : "POLICY_DENY";
    await this.safeRecord({
      event_type: eventType,
      ...correlationFields({
        ...context,
        policy_decision_id: data.policy_decision_id,
      }),
      event_data_json: withRequestId(context, {
        policy_decision_id: data.policy_decision_id,
        decision: data.decision,
        ...(data.reason_code ? { reason_code: data.reason_code } : {}),
        gross_amount_minor: data.gross_amount_minor,
        discount_amount_minor: data.discount_amount_minor,
        final_payable_minor: data.final_payable_minor,
        max_spend_minor: data.max_spend_minor,
        policy_version: data.policy_version,
        evaluated_at: data.evaluated_at,
      }),
      occurred_at: data.evaluated_at,
    });
  }

  async recordRazorpayOrderCreated(
    context: WorkflowAuditContext,
    data: {
      order_id: string;
      razorpay_order_id: string;
      authorized_amount_minor: number;
      currency: string;
      policy_decision_id: string;
    },
  ): Promise<void> {
    await this.safeRecord({
      event_type: "RAZORPAY_ORDER_CREATED",
      ...correlationFields({
        ...context,
        order_id: data.order_id,
        policy_decision_id: data.policy_decision_id,
      }),
      event_data_json: withRequestId(context, {
        order_id: data.order_id,
        razorpay_order_id: data.razorpay_order_id,
        authorized_amount_minor: data.authorized_amount_minor,
        currency: data.currency,
        policy_decision_id: data.policy_decision_id,
      }),
    });
  }

  async recordOrderConfirmed(
    context: WorkflowAuditContext,
    data: {
      order_id: string;
      payment_id: string;
      order_status: string;
      payment_status: string;
      verified_amount_minor: number;
      confirmed_at: string;
    },
  ): Promise<void> {
    await this.safeRecord({
      event_type: "ORDER_CONFIRMED",
      ...correlationFields({
        ...context,
        order_id: data.order_id,
        payment_id: data.payment_id,
      }),
      event_data_json: withRequestId(context, {
        order_id: data.order_id,
        payment_id: data.payment_id,
        order_status: data.order_status,
        payment_status: data.payment_status,
        verified_amount_minor: data.verified_amount_minor,
        confirmed_at: data.confirmed_at,
      }),
      occurred_at: data.confirmed_at,
    });
  }

  async recordPaymentVerifyRequested(
    context: PaymentVerificationAuditContext,
    data: {
      razorpay_order_id: string;
      razorpay_payment_id: string;
    },
  ): Promise<void> {
    await this.safeRecord({
      event_type: "PAYMENT_VERIFY_REQUESTED",
      ...correlationFields(context),
      event_data_json: withRequestId(context, {
        razorpay_order_id: data.razorpay_order_id,
        razorpay_payment_id: data.razorpay_payment_id,
      }),
    });
  }

  async recordPaymentVerified(
    context: AuditCorrelationContext,
    data: {
      razorpay_payment_id: string;
      amount_minor: number;
      verified_at: string;
    },
  ): Promise<void> {
    await this.safeRecord({
      event_type: "PAYMENT_VERIFIED",
      ...correlationFields(context),
      event_data_json: withRequestId(context, {
        razorpay_payment_id: data.razorpay_payment_id,
        amount_minor: data.amount_minor,
        verified_at: data.verified_at,
      }),
      occurred_at: data.verified_at,
    });
  }

  async recordPaymentFailed(
    context: AuditCorrelationContext,
    data: {
      failure_code: string;
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
    },
  ): Promise<void> {
    await this.safeRecord({
      event_type: "PAYMENT_FAILED",
      ...correlationFields(context),
      event_data_json: withRequestId(context, {
        failure_code: data.failure_code,
        ...(data.razorpay_order_id
          ? { razorpay_order_id: data.razorpay_order_id }
          : {}),
        ...(data.razorpay_payment_id
          ? { razorpay_payment_id: data.razorpay_payment_id }
          : {}),
      }),
    });
  }

  async recordAmountMismatch(
    context: AuditCorrelationContext,
    data: {
      expected_amount_minor: number;
      observed_amount_minor: number;
      razorpay_order_id: string;
      razorpay_payment_id: string;
    },
  ): Promise<void> {
    await this.safeRecord({
      event_type: "AMOUNT_MISMATCH",
      ...correlationFields(context),
      event_data_json: withRequestId(context, {
        expected_amount_minor: data.expected_amount_minor,
        observed_amount_minor: data.observed_amount_minor,
        razorpay_order_id: data.razorpay_order_id,
        razorpay_payment_id: data.razorpay_payment_id,
      }),
    });
  }

  async recordWebhookReceived(
    context: WebhookAuditContext,
    data: {
      event_id: string;
      event_type: string;
      razorpay_order_id?: string | null;
      razorpay_payment_id?: string | null;
    },
  ): Promise<void> {
    await this.safeRecord({
      event_type: "WEBHOOK_RECEIVED",
      ...correlationFields(context),
      event_data_json: withRequestId(context, {
        event_id: data.event_id,
        event_type: data.event_type,
        ...(data.razorpay_order_id
          ? { razorpay_order_id: data.razorpay_order_id }
          : {}),
        ...(data.razorpay_payment_id
          ? { razorpay_payment_id: data.razorpay_payment_id }
          : {}),
      }),
    });
  }

  async recordWebhookProcessed(
    context: WebhookAuditContext,
    data: {
      event_id: string;
      outcome: string;
      failure_code?: string;
      payment_status?: string;
      order_status?: string;
    },
  ): Promise<void> {
    await this.safeRecord({
      event_type: "WEBHOOK_PROCESSED",
      ...correlationFields(context),
      event_data_json: withRequestId(context, {
        event_id: data.event_id,
        outcome: data.outcome,
        ...(data.failure_code ? { failure_code: data.failure_code } : {}),
        ...(data.payment_status ? { payment_status: data.payment_status } : {}),
        ...(data.order_status ? { order_status: data.order_status } : {}),
      }),
    });
  }

  private async safeRecord(input: RecordAuditEventInput): Promise<void> {
    try {
      await this.repository.createEvent(input);
    } catch (error) {
      logger.warn("Failed to persist audit event", {
        event_type: input.event_type,
        session_id: input.session_id,
        order_id: input.order_id,
        payment_id: input.payment_id,
        error:
          error instanceof Error ? error.message : "Unknown audit write error",
      });
    }
  }
}
