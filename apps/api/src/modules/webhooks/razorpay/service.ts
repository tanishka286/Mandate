import { createHash } from "node:crypto";
import { AppError } from "../../../shared/errors/index.js";
import { ErrorCodes } from "../../../shared/constants/index.js";
import { AuditService } from "../../audit/index.js";
import type { WebhookAuditContext } from "../../audit/types.js";
import { PaymentsRepository } from "../../payments/repository.js";
import { RazorpayServerAdapter } from "../../payments/razorpay-adapter.js";
import type { Order, Payment, WebhookProcessResult } from "../../payments/types.js";

/** Razorpay payment lifecycle events that may verify payment success. */
export const WEBHOOK_SUCCESS_EVENT_TYPES = new Set([
  "payment.captured",
  "order.paid",
]);

/** Razorpay payment lifecycle failure events. */
export const WEBHOOK_FAILURE_EVENT_TYPES = new Set(["payment.failed"]);

/** Razorpay payment lifecycle pending events (no financial mutation). */
export const WEBHOOK_PENDING_EVENT_TYPES = new Set([
  "payment.pending",
  "payment.authorized",
]);

export interface ParsedRazorpayWebhook {
  event_id: string;
  event_type: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  amount_minor: number | null;
  currency: string | null;
  payment_status: string | null;
  failure_code: string | null;
  payload: Record<string, unknown>;
}

export function hashWebhookPayload(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function parseRazorpayWebhookPayload(
  payload: Record<string, unknown>,
): ParsedRazorpayWebhook {
  const eventId =
    typeof payload.id === "string" && payload.id.trim().length > 0
      ? payload.id.trim()
      : null;
  const eventType =
    typeof payload.event === "string" && payload.event.trim().length > 0
      ? payload.event.trim()
      : "unknown";

  if (!eventId) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Webhook payload is missing event id",
      statusCode: 400,
    });
  }

  const nestedPayload =
    payload.payload && typeof payload.payload === "object"
      ? (payload.payload as Record<string, unknown>)
      : {};

  const paymentContainer = nestedPayload.payment;
  const orderContainer = nestedPayload.order;

  let entity: Record<string, unknown> | null = null;

  if (paymentContainer && typeof paymentContainer === "object") {
    const paymentObj = paymentContainer as Record<string, unknown>;
    if (paymentObj.entity && typeof paymentObj.entity === "object") {
      entity = paymentObj.entity as Record<string, unknown>;
    }
  } else if (orderContainer && typeof orderContainer === "object") {
    const orderObj = orderContainer as Record<string, unknown>;
    if (orderObj.entity && typeof orderObj.entity === "object") {
      entity = orderObj.entity as Record<string, unknown>;
    }
  }

  const razorpayPaymentId =
    entity && typeof entity.id === "string" && entity.id.startsWith("pay_")
      ? entity.id.trim()
      : null;

  const razorpayOrderId =
    entity && typeof entity.order_id === "string"
      ? entity.order_id.trim()
      : entity && typeof entity.id === "string" && entity.id.startsWith("order_")
        ? entity.id.trim()
        : null;

  const amountMinor =
    entity && entity.amount !== undefined && entity.amount !== null
      ? Number(entity.amount)
      : null;

  const currency =
    entity && typeof entity.currency === "string"
      ? entity.currency.trim().toUpperCase()
      : null;

  const paymentStatus =
    entity && typeof entity.status === "string" ? entity.status.trim() : null;

  const failureCode =
    entity && typeof entity.error_code === "string"
      ? entity.error_code.trim()
      : entity && typeof entity.error_description === "string"
        ? entity.error_description.trim()
        : null;

  return {
    event_id: eventId,
    event_type: eventType,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    amount_minor:
      amountMinor !== null && Number.isFinite(amountMinor)
        ? amountMinor
        : null,
    currency,
    payment_status: paymentStatus,
    failure_code: failureCode,
    payload,
  };
}

/**
 * Razorpay webhook service — Phase 8 Step 7.
 * Provider-authenticated webhook processing with idempotent persistence.
 */
export class RazorpayWebhookService {
  constructor(
    private readonly paymentsRepo = new PaymentsRepository(),
    private readonly razorpayAdapter = new RazorpayServerAdapter(),
    private readonly auditService = new AuditService(),
  ) {}

  async processWebhook(input: {
    rawBody: Buffer;
    signature?: string | null;
    request_id?: string | null;
  }): Promise<WebhookProcessResult> {
    const signature = input.signature?.trim();
    if (!signature) {
      throw new AppError({
        code: "WEBHOOK_SIGNATURE_MISSING",
        message: "Webhook signature is required",
        statusCode: 401,
      });
    }

    const isValid = this.razorpayAdapter.verifyWebhookSignature(
      input.rawBody,
      signature,
    );
    if (!isValid) {
      throw new AppError({
        code: "WEBHOOK_SIGNATURE_INVALID",
        message: "Invalid webhook signature",
        statusCode: 401,
      });
    }

    let parsedPayload: Record<string, unknown>;
    try {
      parsedPayload = JSON.parse(input.rawBody.toString("utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Webhook body must be valid JSON",
        statusCode: 400,
      });
    }

    const webhook = parseRazorpayWebhookPayload(parsedPayload);
    const payloadHash = hashWebhookPayload(input.rawBody);

    const claim = await this.paymentsRepo.claimWebhookEventAtomic({
      event_id: webhook.event_id,
      event_type: webhook.event_type,
      payload_hash: payloadHash,
      payload_json: parsedPayload,
    });

    const auditContext = this.buildWebhookAuditContext(
      webhook,
      input.request_id,
    );

    await this.auditService.recordWebhookReceived(auditContext, {
      event_id: webhook.event_id,
      event_type: webhook.event_type,
      razorpay_order_id: webhook.razorpay_order_id,
      razorpay_payment_id: webhook.razorpay_payment_id,
    });

    if (claim.already_processed) {
      await this.finalizeWebhookEvent(claim.webhook_event.webhook_event_id, {
        processingStatus: "PROCESSED",
        errorCode: null,
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "DUPLICATE",
      });
      return {
        event_id: webhook.event_id,
        event_type: webhook.event_type,
        outcome: "DUPLICATE",
      };
    }

    if (!claim.claimed) {
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "CONCURRENT_NOOP",
      });
      return {
        event_id: webhook.event_id,
        event_type: webhook.event_type,
        outcome: "CONCURRENT_NOOP",
      };
    }

    try {
      const result = await this.processClaimedWebhook(
        webhook,
        auditContext,
        claim.webhook_event.webhook_event_id,
      );
      return result;
    } catch (error) {
      const failureCode =
        error instanceof AppError && typeof error.code === "string"
          ? error.code
          : "WEBHOOK_PROCESSING_FAILED";

      await this.finalizeWebhookEvent(claim.webhook_event.webhook_event_id, {
        processingStatus: "FAILED",
        errorCode: failureCode,
      });

      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "FAILED",
        failure_code: failureCode,
      });

      throw error;
    }
  }

  private async processClaimedWebhook(
    webhook: ParsedRazorpayWebhook,
    auditContext: WebhookAuditContext,
    webhookEventId: string,
  ): Promise<WebhookProcessResult> {
    if (WEBHOOK_PENDING_EVENT_TYPES.has(webhook.event_type)) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "IGNORED",
        errorCode: null,
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "IGNORED",
      });
      return {
        event_id: webhook.event_id,
        event_type: webhook.event_type,
        outcome: "IGNORED",
      };
    }

    if (
      !WEBHOOK_SUCCESS_EVENT_TYPES.has(webhook.event_type) &&
      !WEBHOOK_FAILURE_EVENT_TYPES.has(webhook.event_type)
    ) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "IGNORED",
        errorCode: null,
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "IGNORED",
      });
      return {
        event_id: webhook.event_id,
        event_type: webhook.event_type,
        outcome: "IGNORED",
      };
    }

    if (!webhook.razorpay_order_id) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "FAILED",
        errorCode: "WEBHOOK_PROVIDER_ORDER_MISSING",
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "FAILED",
        failure_code: "WEBHOOK_PROVIDER_ORDER_MISSING",
      });
      throw new AppError({
        code: "WEBHOOK_PROVIDER_ORDER_MISSING",
        message: "Webhook is missing Razorpay order identifier",
        statusCode: 422,
      });
    }

    const order = await this.paymentsRepo.findOrderByRazorpayOrderId(
      webhook.razorpay_order_id,
    );
    if (!order) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "FAILED",
        errorCode: "WEBHOOK_ORDER_NOT_FOUND",
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "FAILED",
        failure_code: "WEBHOOK_ORDER_NOT_FOUND",
      });
      throw new AppError({
        code: "WEBHOOK_ORDER_NOT_FOUND",
        message: "No internal order correlates to webhook provider order",
        statusCode: 422,
      });
    }

    const payments = await this.paymentsRepo.findPaymentsByOrderId(
      order.order_id,
    );
    const payment = payments[payments.length - 1];
    if (!payment) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "FAILED",
        errorCode: "WEBHOOK_PAYMENT_NOT_FOUND",
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "FAILED",
        failure_code: "WEBHOOK_PAYMENT_NOT_FOUND",
      });
      throw new AppError({
        code: "WEBHOOK_PAYMENT_NOT_FOUND",
        message: "No internal payment correlates to webhook order",
        statusCode: 422,
      });
    }

    const enrichedAuditContext = this.buildWebhookAuditContext(
      webhook,
      auditContext.request_id,
      order,
      payment,
    );

    if (WEBHOOK_FAILURE_EVENT_TYPES.has(webhook.event_type)) {
      return this.processFailureWebhook(
        webhook,
        enrichedAuditContext,
        webhookEventId,
        order,
        payment,
      );
    }

    return this.processSuccessWebhook(
      webhook,
      enrichedAuditContext,
      webhookEventId,
      order,
      payment,
    );
  }

  private async processSuccessWebhook(
    webhook: ParsedRazorpayWebhook,
    auditContext: WebhookAuditContext,
    webhookEventId: string,
    order: Order,
    payment: Payment,
  ): Promise<WebhookProcessResult> {
    if (!webhook.razorpay_payment_id) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "FAILED",
        errorCode: "WEBHOOK_PROVIDER_PAYMENT_MISSING",
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "FAILED",
        failure_code: "WEBHOOK_PROVIDER_PAYMENT_MISSING",
      });
      throw new AppError({
        code: "WEBHOOK_PROVIDER_PAYMENT_MISSING",
        message: "Webhook success event is missing Razorpay payment identifier",
        statusCode: 422,
      });
    }

    if (
      payment.razorpay_payment_id &&
      payment.razorpay_payment_id !== webhook.razorpay_payment_id &&
      payment.status === "VERIFIED"
    ) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "FAILED",
        errorCode: "WEBHOOK_PAYMENT_IDENTITY_CONFLICT",
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "FAILED",
        failure_code: "WEBHOOK_PAYMENT_IDENTITY_CONFLICT",
      });
      throw new AppError({
        code: "WEBHOOK_PAYMENT_IDENTITY_CONFLICT",
        message: "Verified payment conflicts with webhook provider payment ID",
        statusCode: 409,
      });
    }

    if (
      webhook.amount_minor !== null &&
      (webhook.amount_minor !== order.final_payable_minor ||
        webhook.amount_minor !== payment.amount_minor)
    ) {
      await this.auditService.recordAmountMismatch(auditContext, {
        expected_amount_minor: order.final_payable_minor,
        observed_amount_minor: webhook.amount_minor,
        razorpay_order_id: webhook.razorpay_order_id!,
        razorpay_payment_id: webhook.razorpay_payment_id,
      });
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "FAILED",
        errorCode: "PAYMENT_AMOUNT_MISMATCH",
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "FAILED",
        failure_code: "PAYMENT_AMOUNT_MISMATCH",
      });
      throw new AppError({
        code: "PAYMENT_AMOUNT_MISMATCH",
        message: "Webhook amount does not match authorized order amount",
        statusCode: 422,
      });
    }

    if (
      webhook.currency !== null &&
      (webhook.currency !== "INR" ||
        order.currency !== "INR" ||
        payment.currency !== "INR")
    ) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "FAILED",
        errorCode: "PAYMENT_CURRENCY_MISMATCH",
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "FAILED",
        failure_code: "PAYMENT_CURRENCY_MISMATCH",
      });
      throw new AppError({
        code: "PAYMENT_CURRENCY_MISMATCH",
        message: "Webhook currency mismatch: only INR is supported",
        statusCode: 422,
      });
    }

    if (
      webhook.payment_status &&
      webhook.payment_status !== "captured" &&
      webhook.payment_status !== "paid" &&
      webhook.event_type !== "order.paid"
    ) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "IGNORED",
        errorCode: null,
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "IGNORED",
      });
      return {
        event_id: webhook.event_id,
        event_type: webhook.event_type,
        outcome: "IGNORED",
        payment_status: payment.status,
        order_status: order.status,
      };
    }

    const verifiedAt = new Date().toISOString();
    const persistence = await this.paymentsRepo.verifyPaymentPersistenceAtomic({
      order_id: order.order_id,
      payment_id: payment.payment_id,
      razorpay_payment_id: webhook.razorpay_payment_id,
      verified_at: verifiedAt,
      method: null,
    });

    if (!persistence.replayed) {
      await this.auditService.recordPaymentVerified(auditContext, {
        razorpay_payment_id: webhook.razorpay_payment_id,
        amount_minor: persistence.payment.amount_minor,
        verified_at: persistence.payment.verified_at ?? verifiedAt,
      });

      await this.auditService.recordOrderConfirmed(auditContext, {
        order_id: persistence.order.order_id,
        payment_id: persistence.payment.payment_id,
        order_status: persistence.order.status,
        payment_status: persistence.payment.status,
        verified_amount_minor: persistence.payment.amount_minor,
        confirmed_at: persistence.payment.verified_at ?? verifiedAt,
      });
    }

    await this.finalizeWebhookEvent(webhookEventId, {
      processingStatus: "PROCESSED",
      errorCode: null,
    });
    await this.auditService.recordWebhookProcessed(auditContext, {
      event_id: webhook.event_id,
      outcome: persistence.replayed ? "DUPLICATE" : "PROCESSED",
      payment_status: persistence.payment.status,
      order_status: persistence.order.status,
    });

    return {
      event_id: webhook.event_id,
      event_type: webhook.event_type,
      outcome: persistence.replayed ? "DUPLICATE" : "PROCESSED",
      payment_status: persistence.payment.status,
      order_status: persistence.order.status,
    };
  }

  private async processFailureWebhook(
    webhook: ParsedRazorpayWebhook,
    auditContext: WebhookAuditContext,
    webhookEventId: string,
    order: Order,
    payment: Payment,
  ): Promise<WebhookProcessResult> {
    const persistence =
      await this.paymentsRepo.processWebhookPaymentFailureAtomic({
        order_id: order.order_id,
        payment_id: payment.payment_id,
        razorpay_payment_id: webhook.razorpay_payment_id,
        failure_code: webhook.failure_code ?? webhook.event_type,
      });

    if (persistence.downgrade_prevented) {
      await this.finalizeWebhookEvent(webhookEventId, {
        processingStatus: "PROCESSED",
        errorCode: null,
      });
      await this.auditService.recordWebhookProcessed(auditContext, {
        event_id: webhook.event_id,
        outcome: "DUPLICATE",
        payment_status: persistence.payment.status,
        order_status: persistence.order.status,
      });
      return {
        event_id: webhook.event_id,
        event_type: webhook.event_type,
        outcome: "DUPLICATE",
        payment_status: persistence.payment.status,
        order_status: persistence.order.status,
      };
    }

    if (!persistence.replayed) {
      await this.auditService.recordPaymentFailed(auditContext, {
        failure_code: webhook.failure_code ?? webhook.event_type,
        razorpay_order_id: webhook.razorpay_order_id ?? undefined,
        razorpay_payment_id: webhook.razorpay_payment_id ?? undefined,
      });
    }

    await this.finalizeWebhookEvent(webhookEventId, {
      processingStatus: "PROCESSED",
      errorCode: null,
    });
    await this.auditService.recordWebhookProcessed(auditContext, {
      event_id: webhook.event_id,
      outcome: persistence.replayed ? "DUPLICATE" : "PROCESSED",
      payment_status: persistence.payment.status,
      order_status: persistence.order.status,
    });

    return {
      event_id: webhook.event_id,
      event_type: webhook.event_type,
      outcome: persistence.replayed ? "DUPLICATE" : "PROCESSED",
      payment_status: persistence.payment.status,
      order_status: persistence.order.status,
    };
  }

  private async finalizeWebhookEvent(
    webhookEventId: string,
    input: {
      processingStatus: "PROCESSED" | "IGNORED" | "FAILED";
      errorCode: string | null;
    },
  ): Promise<void> {
    await this.paymentsRepo.updateWebhookEventStatus({
      webhookEventId,
      processingStatus: input.processingStatus,
      errorCode: input.errorCode,
      processedAt: new Date().toISOString(),
    });
  }

  private buildWebhookAuditContext(
    webhook: ParsedRazorpayWebhook,
    requestId?: string | null,
    order?: Order,
    payment?: Payment,
  ): WebhookAuditContext {
    return {
      request_id: requestId ?? null,
      order_id: order?.order_id ?? null,
      payment_id: payment?.payment_id ?? null,
      user_id: order?.user_id ?? null,
      session_id: order?.session_id ?? null,
      mandate_id: order?.mandate_id ?? null,
      basket_id: order?.basket_id ?? null,
      policy_decision_id: order?.policy_decision_id ?? null,
      event_id: webhook.event_id,
      event_type: webhook.event_type,
      razorpay_order_id: webhook.razorpay_order_id,
      razorpay_payment_id: webhook.razorpay_payment_id,
    };
  }
}
