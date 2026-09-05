import { logger } from "../../shared/logger/index.js";
import { sanitizeAuditEventData } from "./sanitize.js";
import { AuditRepository } from "./repository.js";
import type {
  AuditCorrelationContext,
  PaymentVerificationAuditContext,
  RecordAuditEventInput,
  WebhookAuditContext,
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
  | "mandate_id"
  | "basket_id"
  | "policy_decision_id"
  | "order_id"
  | "payment_id"
> {
  return {
    user_id: context.user_id ?? null,
    session_id: context.session_id ?? null,
    mandate_id: context.mandate_id ?? null,
    basket_id: context.basket_id ?? null,
    policy_decision_id: context.policy_decision_id ?? null,
    order_id: context.order_id ?? null,
    payment_id: context.payment_id ?? null,
  };
}

/**
 * Audit service — Phase 8 payment verification and webhook events.
 * Audit write failures must not affect payment or webhook outcomes.
 */
export class AuditService {
  constructor(private readonly repository = new AuditRepository()) {}

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
        order_id: input.order_id,
        payment_id: input.payment_id,
        error:
          error instanceof Error ? error.message : "Unknown audit write error",
      });
    }
  }
}
