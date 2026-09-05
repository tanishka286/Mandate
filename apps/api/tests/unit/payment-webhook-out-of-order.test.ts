import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RazorpayWebhookService,
} from "../../src/modules/webhooks/razorpay/service.js";
import { AuditService } from "../../src/modules/audit/service.js";
import type { Order, Payment, RazorpayWebhookEventRecord } from "../../src/modules/payments/types.js";

const WEBHOOK_SECRET = "whsec_out_of_order_webhook_secret";
const userId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";
const razorpayOrderId = "order_rzp_out_of_order";
const razorpayPaymentId = "pay_rzp_out_of_order";
const amountMinor = 4500;

function signWebhook(body: Buffer): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

function buildCapturedPayload(eventId: string) {
  return {
    entity: "event",
    id: eventId,
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: razorpayPaymentId,
          order_id: razorpayOrderId,
          amount: amountMinor,
          currency: "INR",
          status: "captured",
        },
      },
    },
  };
}

function buildFailedPayload(eventId: string) {
  return {
    entity: "event",
    id: eventId,
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: razorpayPaymentId,
          order_id: razorpayOrderId,
          amount: amountMinor,
          currency: "INR",
          status: "failed",
          error_code: "BAD_REQUEST_ERROR",
        },
      },
    },
  };
}

describe("RazorpayWebhookService out-of-order sequencing (Phase 10)", () => {
  let mockOrder: Order;
  let mockPayment: Payment;
  let webhookEvent: RazorpayWebhookEventRecord;
  let mockRepo: {
    claimWebhookEventAtomic: ReturnType<typeof vi.fn>;
    findOrderByRazorpayOrderId: ReturnType<typeof vi.fn>;
    findPaymentsByOrderId: ReturnType<typeof vi.fn>;
    verifyPaymentPersistenceAtomic: ReturnType<typeof vi.fn>;
    processWebhookPaymentFailureAtomic: ReturnType<typeof vi.fn>;
    updateWebhookEventStatus: ReturnType<typeof vi.fn>;
  };
  let auditSpy: {
    recordWebhookReceived: ReturnType<typeof vi.fn>;
    recordWebhookProcessed: ReturnType<typeof vi.fn>;
    recordPaymentVerified: ReturnType<typeof vi.fn>;
    recordPaymentFailed: ReturnType<typeof vi.fn>;
    recordAmountMismatch: ReturnType<typeof vi.fn>;
    recordOrderConfirmed: ReturnType<typeof vi.fn>;
  };
  let service: RazorpayWebhookService;

  beforeEach(() => {
    mockOrder = {
      order_id: orderId,
      user_id: userId,
      session_id: "44444444-4444-4444-8444-444444444444",
      mandate_id: "55555555-5555-4555-8555-555555555555",
      basket_id: "66666666-6666-4666-8666-666666666666",
      policy_decision_id: "77777777-7777-4777-8777-777777777777",
      status: "PAYMENT_VERIFIED",
      gross_amount_minor: amountMinor,
      discount_amount_minor: 0,
      final_payable_minor: amountMinor,
      currency: "INR",
      razorpay_order_id: razorpayOrderId,
      created_at: "2026-09-05T12:00:00.000Z",
      updated_at: "2026-09-05T12:01:00.000Z",
    };

    mockPayment = {
      payment_id: paymentId,
      order_id: orderId,
      razorpay_payment_id: razorpayPaymentId,
      status: "VERIFIED",
      amount_minor: amountMinor,
      currency: "INR",
      method: "card",
      verified_at: "2026-09-05T12:01:00.000Z",
      failure_code: null,
      metadata_json: {},
      created_at: "2026-09-05T12:00:00.000Z",
      updated_at: "2026-09-05T12:01:00.000Z",
    };

    webhookEvent = {
      webhook_event_id: "88888888-8888-4888-8888-888888888888",
      event_id: "evt_out_of_order_001",
      event_type: "payment.failed",
      payload_hash: "hash",
      received_at: "2026-09-05T12:02:00.000Z",
      processed_at: null,
      processing_status: "PROCESSING",
      error_code: null,
      payload_json: {},
      created_at: "2026-09-05T12:02:00.000Z",
      updated_at: "2026-09-05T12:02:00.000Z",
    };

    mockRepo = {
      claimWebhookEventAtomic: vi.fn().mockResolvedValue({
        webhook_event: webhookEvent,
        claimed: true,
        already_processed: false,
        is_duplicate_delivery: false,
      }),
      findOrderByRazorpayOrderId: vi.fn().mockResolvedValue(mockOrder),
      findPaymentsByOrderId: vi.fn().mockResolvedValue([mockPayment]),
      verifyPaymentPersistenceAtomic: vi.fn(),
      processWebhookPaymentFailureAtomic: vi.fn().mockResolvedValue({
        order: mockOrder,
        payment: mockPayment,
        replayed: true,
        downgrade_prevented: true,
      }),
      updateWebhookEventStatus: vi.fn().mockResolvedValue(webhookEvent),
    };

    auditSpy = {
      recordWebhookReceived: vi.fn().mockResolvedValue(undefined),
      recordWebhookProcessed: vi.fn().mockResolvedValue(undefined),
      recordPaymentVerified: vi.fn().mockResolvedValue(undefined),
      recordPaymentFailed: vi.fn().mockResolvedValue(undefined),
      recordAmountMismatch: vi.fn().mockResolvedValue(undefined),
      recordOrderConfirmed: vi.fn().mockResolvedValue(undefined),
    };

    service = new RazorpayWebhookService(
      mockRepo as never,
      { verifyWebhookSignature: vi.fn().mockReturnValue(true) } as never,
      auditSpy as unknown as AuditService,
    );
  });

  it("does not downgrade VERIFIED payment when late payment.failed arrives", async () => {
    const body = Buffer.from(JSON.stringify(buildFailedPayload("evt_late_fail")));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });

    expect(result.outcome).toBe("DUPLICATE");
    expect(mockRepo.processWebhookPaymentFailureAtomic).toHaveBeenCalled();
    expect(auditSpy.recordPaymentFailed).not.toHaveBeenCalled();
    expect(mockRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  it("remains idempotent when duplicate compatible payment.captured replays after VERIFIED", async () => {
    mockRepo.claimWebhookEventAtomic.mockResolvedValue({
      webhook_event: {
        ...webhookEvent,
        event_id: "evt_dup_capture",
        event_type: "payment.captured",
      },
      claimed: true,
      already_processed: false,
      is_duplicate_delivery: false,
    });
    mockRepo.verifyPaymentPersistenceAtomic.mockResolvedValue({
      order: mockOrder,
      payment: mockPayment,
      replayed: true,
    });

    const body = Buffer.from(JSON.stringify(buildCapturedPayload("evt_dup_capture")));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });

    expect(result.outcome).toBe("DUPLICATE");
    expect(auditSpy.recordPaymentVerified).not.toHaveBeenCalled();
    expect(auditSpy.recordPaymentFailed).not.toHaveBeenCalled();
  });

  it("keeps audit consistent by recording webhook receipt without failure mutation on downgrade block", async () => {
    const body = Buffer.from(JSON.stringify(buildFailedPayload("evt_audit_late_fail")));
    await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
      request_id: "req-out-of-order-audit",
    });

    expect(auditSpy.recordWebhookReceived).toHaveBeenCalled();
    expect(auditSpy.recordWebhookProcessed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "DUPLICATE" }),
    );
    expect(auditSpy.recordPaymentFailed).not.toHaveBeenCalled();
  });
});
