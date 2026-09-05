import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RazorpayWebhookService,
  parseRazorpayWebhookPayload,
} from "../../src/modules/webhooks/razorpay/service.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { AppError } from "../../src/shared/errors/index.js";
import type { Order, Payment, RazorpayWebhookEventRecord } from "../../src/modules/payments/types.js";

const WEBHOOK_SECRET = "whsec_unit_test_webhook_secret";
const userId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";
const razorpayOrderId = "order_rzp_webhook_unit";
const razorpayPaymentId = "pay_rzp_webhook_unit";
const amountMinor = 4500;
const eventId = "evt_webhook_unit_001";

function signWebhook(body: Buffer): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

function buildCapturedPayload(overrides?: {
  eventId?: string;
  amount?: number;
  currency?: string;
  orderId?: string;
  paymentId?: string;
  status?: string;
}) {
  return {
    entity: "event",
    id: overrides?.eventId ?? eventId,
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: overrides?.paymentId ?? razorpayPaymentId,
          order_id: overrides?.orderId ?? razorpayOrderId,
          amount: overrides?.amount ?? amountMinor,
          currency: overrides?.currency ?? "INR",
          status: overrides?.status ?? "captured",
        },
      },
    },
  };
}

function buildFailedPayload(eventIdValue = eventId) {
  return {
    entity: "event",
    id: eventIdValue,
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

describe("RazorpayWebhookService (Phase 8 Step 7)", () => {
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
      status: "PAYMENT_PENDING",
      gross_amount_minor: amountMinor,
      discount_amount_minor: 0,
      final_payable_minor: amountMinor,
      currency: "INR",
      razorpay_order_id: razorpayOrderId,
      created_at: "2026-09-05T12:00:00.000Z",
      updated_at: "2026-09-05T12:00:00.000Z",
    };

    mockPayment = {
      payment_id: paymentId,
      order_id: orderId,
      razorpay_payment_id: null,
      status: "PAYMENT_PENDING",
      amount_minor: amountMinor,
      currency: "INR",
      method: null,
      verified_at: null,
      failure_code: null,
      metadata_json: {},
      created_at: "2026-09-05T12:00:00.000Z",
      updated_at: "2026-09-05T12:00:00.000Z",
    };

    webhookEvent = {
      webhook_event_id: "88888888-8888-4888-8888-888888888888",
      event_id: eventId,
      event_type: "payment.captured",
      payload_hash: "hash",
      received_at: "2026-09-05T12:00:00.000Z",
      processed_at: null,
      processing_status: "PROCESSING",
      error_code: null,
      payload_json: {},
      created_at: "2026-09-05T12:00:00.000Z",
      updated_at: "2026-09-05T12:00:00.000Z",
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
      verifyPaymentPersistenceAtomic: vi.fn().mockResolvedValue({
        order: { ...mockOrder, status: "PAYMENT_VERIFIED" },
        payment: {
          ...mockPayment,
          status: "VERIFIED",
          razorpay_payment_id: razorpayPaymentId,
          verified_at: "2026-09-05T12:01:00.000Z",
        },
        replayed: false,
      }),
      processWebhookPaymentFailureAtomic: vi.fn().mockResolvedValue({
        order: { ...mockOrder, status: "PAYMENT_FAILED" },
        payment: {
          ...mockPayment,
          status: "FAILED",
          razorpay_payment_id: razorpayPaymentId,
        },
        replayed: false,
        downgrade_prevented: false,
      }),
      updateWebhookEventStatus: vi.fn().mockResolvedValue(webhookEvent),
    };

    auditSpy = {
      recordWebhookReceived: vi.fn().mockResolvedValue(undefined),
      recordWebhookProcessed: vi.fn().mockResolvedValue(undefined),
      recordPaymentVerified: vi.fn().mockResolvedValue(undefined),
      recordPaymentFailed: vi.fn().mockResolvedValue(undefined),
      recordAmountMismatch: vi.fn().mockResolvedValue(undefined),
    };

    service = new RazorpayWebhookService(
      mockRepo as never,
      { verifyWebhookSignature: vi.fn().mockReturnValue(true) } as never,
      auditSpy as unknown as AuditService,
    );
  });

  it("1. processes valid signed payment.captured webhook", async () => {
    const body = Buffer.from(JSON.stringify(buildCapturedPayload()));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });
    expect(result.outcome).toBe("PROCESSED");
    expect(mockRepo.verifyPaymentPersistenceAtomic).toHaveBeenCalled();
    expect(auditSpy.recordWebhookReceived).toHaveBeenCalled();
    expect(auditSpy.recordWebhookProcessed).toHaveBeenCalled();
    expect(auditSpy.recordPaymentVerified).toHaveBeenCalled();
  });

  it("2. rejects invalid webhook signature without repository mutation", async () => {
    const invalidService = new RazorpayWebhookService(
      mockRepo as never,
      { verifyWebhookSignature: vi.fn().mockReturnValue(false) } as never,
      auditSpy as unknown as AuditService,
    );
    const body = Buffer.from(JSON.stringify(buildCapturedPayload()));
    await expect(
      invalidService.processWebhook({
        rawBody: body,
        signature: "invalid",
      }),
    ).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
    expect(mockRepo.claimWebhookEventAtomic).not.toHaveBeenCalled();
  });

  it("3. rejects missing signature", async () => {
    const body = Buffer.from(JSON.stringify(buildCapturedPayload()));
    await expect(
      service.processWebhook({ rawBody: body, signature: null }),
    ).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_MISSING" });
    expect(mockRepo.claimWebhookEventAtomic).not.toHaveBeenCalled();
  });

  it("4. rejects malformed JSON body", async () => {
    const body = Buffer.from("{not-json");
    await expect(
      service.processWebhook({ rawBody: body, signature: signWebhook(body) }),
    ).rejects.toBeInstanceOf(AppError);
    expect(mockRepo.claimWebhookEventAtomic).not.toHaveBeenCalled();
  });

  it("5. safely ignores unknown event types", async () => {
    const payload = { ...buildCapturedPayload(), event: "subscription.activated" };
    const body = Buffer.from(JSON.stringify(payload));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });
    expect(result.outcome).toBe("IGNORED");
    expect(mockRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
    expect(auditSpy.recordWebhookProcessed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "IGNORED" }),
    );
  });

  it("6. returns DUPLICATE for already-processed event", async () => {
    mockRepo.claimWebhookEventAtomic.mockResolvedValue({
      webhook_event: { ...webhookEvent, processing_status: "PROCESSED" },
      claimed: false,
      already_processed: true,
      is_duplicate_delivery: true,
    });
    const body = Buffer.from(JSON.stringify(buildCapturedPayload()));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });
    expect(result.outcome).toBe("DUPLICATE");
    expect(mockRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  it("7. returns CONCURRENT_NOOP when another worker claimed processing", async () => {
    mockRepo.claimWebhookEventAtomic.mockResolvedValue({
      webhook_event: webhookEvent,
      claimed: false,
      already_processed: false,
      is_duplicate_delivery: true,
    });
    const body = Buffer.from(JSON.stringify(buildCapturedPayload()));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });
    expect(result.outcome).toBe("CONCURRENT_NOOP");
  });

  it("8. processes payment.failed for PAYMENT_PENDING", async () => {
    const body = Buffer.from(JSON.stringify(buildFailedPayload()));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });
    expect(result.outcome).toBe("PROCESSED");
    expect(mockRepo.processWebhookPaymentFailureAtomic).toHaveBeenCalled();
    expect(auditSpy.recordPaymentFailed).toHaveBeenCalled();
  });

  it("9. ignores payment.pending without financial mutation", async () => {
    const payload = {
      ...buildCapturedPayload(),
      event: "payment.pending",
      payload: {
        payment: {
          entity: {
            id: razorpayPaymentId,
            order_id: razorpayOrderId,
            amount: amountMinor,
            currency: "INR",
            status: "created",
          },
        },
      },
    };
    const body = Buffer.from(JSON.stringify(payload));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });
    expect(result.outcome).toBe("IGNORED");
    expect(mockRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  it("10. does not downgrade VERIFIED on late failure webhook", async () => {
    mockRepo.processWebhookPaymentFailureAtomic.mockResolvedValue({
      order: { ...mockOrder, status: "PAYMENT_VERIFIED" },
      payment: {
        ...mockPayment,
        status: "VERIFIED",
        razorpay_payment_id: razorpayPaymentId,
      },
      replayed: true,
      downgrade_prevented: true,
    });
    const body = Buffer.from(JSON.stringify(buildFailedPayload()));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });
    expect(result.outcome).toBe("DUPLICATE");
    expect(auditSpy.recordPaymentFailed).not.toHaveBeenCalled();
  });

  it("11. fails closed on amount mismatch", async () => {
    const body = Buffer.from(
      JSON.stringify(buildCapturedPayload({ amount: amountMinor + 100 })),
    );
    await expect(
      service.processWebhook({ rawBody: body, signature: signWebhook(body) }),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH" });
    expect(auditSpy.recordAmountMismatch).toHaveBeenCalled();
    expect(mockRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  it("12. fails closed on currency mismatch", async () => {
    const body = Buffer.from(
      JSON.stringify(buildCapturedPayload({ currency: "USD" })),
    );
    await expect(
      service.processWebhook({ rawBody: body, signature: signWebhook(body) }),
    ).rejects.toMatchObject({ code: "PAYMENT_CURRENCY_MISMATCH" });
    expect(mockRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  it("13. rejects provider order mismatch (unknown order)", async () => {
    mockRepo.findOrderByRazorpayOrderId.mockResolvedValue(null);
    const body = Buffer.from(JSON.stringify(buildCapturedPayload()));
    await expect(
      service.processWebhook({ rawBody: body, signature: signWebhook(body) }),
    ).rejects.toMatchObject({ code: "WEBHOOK_ORDER_NOT_FOUND" });
  });

  it("14. rejects missing provider payment id on success event", async () => {
    const payload = buildCapturedPayload();
    (payload.payload.payment.entity as Record<string, unknown>).id = "not_a_payment";
    const body = Buffer.from(JSON.stringify(payload));
    await expect(
      service.processWebhook({ rawBody: body, signature: signWebhook(body) }),
    ).rejects.toMatchObject({ code: "WEBHOOK_PROVIDER_PAYMENT_MISSING" });
  });

  it("15. idempotent success for duplicate compatible VERIFIED replay", async () => {
    mockRepo.verifyPaymentPersistenceAtomic.mockResolvedValue({
      order: { ...mockOrder, status: "PAYMENT_VERIFIED" },
      payment: {
        ...mockPayment,
        status: "VERIFIED",
        razorpay_payment_id: razorpayPaymentId,
        verified_at: "2026-09-05T12:01:00.000Z",
      },
      replayed: true,
    });
    const body = Buffer.from(JSON.stringify(buildCapturedPayload()));
    const result = await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
    });
    expect(result.outcome).toBe("DUPLICATE");
    expect(auditSpy.recordPaymentVerified).not.toHaveBeenCalled();
  });

  it("16. audit payloads exclude secrets when sanitized downstream", async () => {
    const body = Buffer.from(JSON.stringify(buildCapturedPayload()));
    await service.processWebhook({
      rawBody: body,
      signature: signWebhook(body),
      request_id: "req-webhook-audit",
    });
    const receivedCall = auditSpy.recordWebhookReceived.mock.calls[0]?.[1];
    expect(JSON.stringify(receivedCall)).not.toContain(WEBHOOK_SECRET);
    expect(JSON.stringify(receivedCall)).not.toContain("razorpay_signature");
  });

  it("17. parseRazorpayWebhookPayload extracts provider identifiers", () => {
    const parsed = parseRazorpayWebhookPayload(buildCapturedPayload());
    expect(parsed.event_id).toBe(eventId);
    expect(parsed.razorpay_order_id).toBe(razorpayOrderId);
    expect(parsed.razorpay_payment_id).toBe(razorpayPaymentId);
    expect(parsed.amount_minor).toBe(amountMinor);
  });
});
