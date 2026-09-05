import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditService } from "../../src/modules/audit/service.js";
import { AuditRepository } from "../../src/modules/audit/repository.js";
import { PaymentsService } from "../../src/modules/payments/service.js";
import { sanitizeAuditEventData } from "../../src/modules/audit/sanitize.js";
import { AUDIT_EVENT_TYPES } from "../../src/modules/audit/types.js";
import type { Order, Payment } from "../../src/modules/payments/types.js";

const userA = "44444444-4444-4444-8444-444444444401";
const userB = "44444444-4444-4444-8444-444444444402";
const sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const sessionB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";

describe("Phase 9 audit workflow (AUDIT-001..016)", () => {
  const sessionId = sessionA;
  const mandateId = "77777777-7777-4777-8777-777777777701";
  const intentId = "88888888-8888-4888-8888-888888888801";
  const basketId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
  const policyDecisionId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  const orderId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  const paymentId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
  const requestId = "req-audit-workflow-001";

  let storedEvents: Array<Record<string, unknown>>;

  beforeEach(() => {
    storedEvents = [];
    vi.spyOn(AuditRepository.prototype, "createEvent").mockImplementation(
      async (input) => {
        const row = {
          audit_event_id: `audit-${storedEvents.length + 1}`,
          ...input,
          agent_run_id: input.agent_run_id ?? null,
          optimization_run_id: input.optimization_run_id ?? null,
          created_at: new Date().toISOString(),
        };
        storedEvents.push(row);
        return row as never;
      },
    );
    vi.spyOn(AuditRepository.prototype, "listBySessionId").mockImplementation(
      async (sid) =>
        storedEvents
          .filter((e) => e.session_id === sid)
          .map((e) => ({
            audit_event_id: e.audit_event_id as string,
            event_type: e.event_type as string,
            occurred_at: (e.occurred_at as string) ?? new Date().toISOString(),
            user_id: (e.user_id as string) ?? null,
            session_id: (e.session_id as string) ?? null,
            agent_run_id: (e.agent_run_id as string) ?? null,
            mandate_id: (e.mandate_id as string) ?? null,
            optimization_run_id: (e.optimization_run_id as string) ?? null,
            basket_id: (e.basket_id as string) ?? null,
            policy_decision_id: (e.policy_decision_id as string) ?? null,
            order_id: (e.order_id as string) ?? null,
            payment_id: (e.payment_id as string) ?? null,
            event_data: (e.event_data_json as Record<string, unknown>) ?? {},
          })),
    );
  });

  it("AUDIT-001: happy-path workflow produces required material audit chain", async () => {
    const audit = new AuditService();
    const ctx = {
      user_id: userA,
      session_id: sessionId,
      mandate_id: mandateId,
      request_id: requestId,
    };

    await audit.recordIntentReceived(ctx, {
      intent_id: intentId,
      goal_category: "pantry",
      budget_minor: 50000,
    });
    await audit.recordRequirementsCreated(ctx, {
      intent_id: intentId,
      requirement_ids: ["req-1", "req-2"],
    });
    await audit.recordProductResearched(ctx, {
      product_id: "prod-1",
      evidence_ids: ["ev-1"],
      quality_signal: "GOOD",
      confidence: 0.9,
    });
    await audit.recordBasketCreated(
      { ...ctx, optimization_run_id: "opt-run-1" },
      {
        basket_id: basketId,
        basket_type: "BEST_VALUE",
        gross_amount_minor: 10000,
        discount_amount_minor: 500,
        final_payable_minor: 9500,
      },
    );
    await audit.recordBasketSelected(ctx, {
      selection_id: "sel-1",
      basket_id: basketId,
      selection_source: "USER",
    });
    await audit.recordFreshQuote(ctx, {
      basket_id: basketId,
      quote_version: "quote-test-v1",
      gross_amount_minor: 10000,
      discount_amount_minor: 500,
      final_payable_minor: 9500,
      basket_state_version: 1,
      selection_id: "sel-1",
    });
    await audit.recordPolicyDecision(
      { ...ctx, basket_id: basketId, policy_decision_id: policyDecisionId },
      {
        policy_decision_id: policyDecisionId,
        decision: "ALLOW",
        gross_amount_minor: 10000,
        discount_amount_minor: 500,
        final_payable_minor: 9500,
        max_spend_minor: 50000,
        policy_version: "1.0.0",
        evaluated_at: "2026-09-05T12:00:00.000Z",
      },
    );
    await audit.recordRazorpayOrderCreated(
      {
        ...ctx,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        order_id: orderId,
      },
      {
        order_id: orderId,
        razorpay_order_id: "order_rzp_1",
        authorized_amount_minor: 9500,
        currency: "INR",
        policy_decision_id: policyDecisionId,
      },
    );
    await audit.recordPaymentVerified(
      {
        ...ctx,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        order_id: orderId,
        payment_id: paymentId,
      },
      {
        razorpay_payment_id: "pay_rzp_1",
        amount_minor: 9500,
        verified_at: "2026-09-05T12:05:00.000Z",
      },
    );
    await audit.recordOrderConfirmed(
      {
        ...ctx,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        order_id: orderId,
        payment_id: paymentId,
      },
      {
        order_id: orderId,
        payment_id: paymentId,
        order_status: "PAYMENT_VERIFIED",
        payment_status: "VERIFIED",
        verified_amount_minor: 9500,
        confirmed_at: "2026-09-05T12:05:00.000Z",
      },
    );

    const types = storedEvents.map((e) => e.event_type);
    expect(types).toContain("INTENT_RECEIVED");
    expect(types).toContain("REQUIREMENTS_CREATED");
    expect(types).toContain("PRODUCT_RESEARCHED");
    expect(types).toContain("BASKET_CREATED");
    expect(types).toContain("BASKET_SELECTED");
    expect(types).toContain("FRESH_QUOTE");
    expect(types).toContain("POLICY_ALLOW");
    expect(types).toContain("RAZORPAY_ORDER_CREATED");
    expect(types).toContain("PAYMENT_VERIFIED");
    expect(types).toContain("ORDER_CONFIRMED");
  });

  it("AUDIT-002: audit records preserve correlation identifiers", async () => {
    const audit = new AuditService();
    await audit.recordIntentReceived(
      {
        user_id: userA,
        session_id: sessionId,
        mandate_id: mandateId,
        request_id: requestId,
      },
      { intent_id: intentId, goal_category: "dairy" },
    );

    const event = storedEvents[0];
    expect(event.user_id).toBe(userA);
    expect(event.session_id).toBe(sessionId);
    expect(event.mandate_id).toBe(mandateId);
    expect((event.event_data_json as Record<string, unknown>).request_id).toBe(
      requestId,
    );
  });

  it("AUDIT-003: policy ALLOW is auditable", async () => {
    const audit = new AuditService();
    await audit.recordPolicyDecision(
      {
        user_id: userA,
        session_id: sessionId,
        mandate_id: mandateId,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        request_id: requestId,
      },
      {
        policy_decision_id: policyDecisionId,
        decision: "ALLOW",
        gross_amount_minor: 1000,
        discount_amount_minor: 0,
        final_payable_minor: 1000,
        max_spend_minor: 50000,
        policy_version: "1.0.0",
        evaluated_at: "2026-09-05T12:00:00.000Z",
      },
    );
    expect(storedEvents[0].event_type).toBe("POLICY_ALLOW");
  });

  it("AUDIT-004: policy DENY is auditable", async () => {
    const audit = new AuditService();
    await audit.recordPolicyDecision(
      {
        user_id: userA,
        session_id: sessionId,
        mandate_id: mandateId,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
      },
      {
        policy_decision_id: policyDecisionId,
        decision: "DENY",
        reason_code: "MAX_SPEND_EXCEEDED",
        gross_amount_minor: 60000,
        discount_amount_minor: 0,
        final_payable_minor: 60000,
        max_spend_minor: 50000,
        policy_version: "1.0.0",
        evaluated_at: "2026-09-05T12:00:00.000Z",
      },
    );
    expect(storedEvents[0].event_type).toBe("POLICY_DENY");
    expect(
      (storedEvents[0].event_data_json as Record<string, unknown>).reason_code,
    ).toBe("MAX_SPEND_EXCEEDED");
  });

  it("AUDIT-005: Razorpay order creation is auditable", async () => {
    const audit = new AuditService();
    await audit.recordRazorpayOrderCreated(
      {
        user_id: userA,
        session_id: sessionId,
        order_id: orderId,
        policy_decision_id: policyDecisionId,
      },
      {
        order_id: orderId,
        razorpay_order_id: "order_rzp_test",
        authorized_amount_minor: 9500,
        currency: "INR",
        policy_decision_id: policyDecisionId,
      },
    );
    expect(storedEvents[0].event_type).toBe("RAZORPAY_ORDER_CREATED");
    expect(
      (storedEvents[0].event_data_json as Record<string, unknown>)
        .razorpay_order_id,
    ).toBe("order_rzp_test");
  });

  it("AUDIT-006: payment verification is auditable", async () => {
    const audit = new AuditService();
    await audit.recordPaymentVerified(
      {
        user_id: userA,
        session_id: sessionId,
        order_id: orderId,
        payment_id: paymentId,
      },
      {
        razorpay_payment_id: "pay_rzp_test",
        amount_minor: 9500,
        verified_at: "2026-09-05T12:05:00.000Z",
      },
    );
    expect(storedEvents[0].event_type).toBe("PAYMENT_VERIFIED");
  });

  it("AUDIT-007: payment failure is auditable", async () => {
    const audit = new AuditService();
    await audit.recordPaymentFailed(
      { user_id: userA, session_id: sessionId, order_id: orderId },
      { failure_code: "PAYMENT_SIGNATURE_INVALID" },
    );
    expect(storedEvents[0].event_type).toBe("PAYMENT_FAILED");
  });

  it("AUDIT-008: webhook received/processed is auditable", async () => {
    const audit = new AuditService();
    const webhookCtx = {
      event_id: "evt_1",
      event_type: "payment.captured",
      user_id: userA,
      session_id: sessionId,
      request_id: requestId,
    };
    await audit.recordWebhookReceived(webhookCtx, {
      event_id: "evt_1",
      event_type: "payment.captured",
      razorpay_order_id: "order_rzp_1",
    });
    await audit.recordWebhookProcessed(webhookCtx, {
      event_id: "evt_1",
      outcome: "PROCESSED",
      payment_status: "VERIFIED",
      order_status: "PAYMENT_VERIFIED",
    });
    expect(storedEvents.map((e) => e.event_type)).toEqual([
      "WEBHOOK_RECEIVED",
      "WEBHOOK_PROCESSED",
    ]);
  });

  it("AUDIT-009: amount mismatch is auditable", async () => {
    const audit = new AuditService();
    await audit.recordAmountMismatch(
      { user_id: userA, session_id: sessionId, order_id: orderId },
      {
        expected_amount_minor: 9500,
        observed_amount_minor: 10000,
        razorpay_order_id: "order_rzp_1",
        razorpay_payment_id: "pay_rzp_1",
      },
    );
    expect(storedEvents[0].event_type).toBe("AMOUNT_MISMATCH");
  });

  it("AUDIT-010: final order confirmation is auditable", async () => {
    const audit = new AuditService();
    await audit.recordOrderConfirmed(
      {
        user_id: userA,
        session_id: sessionId,
        order_id: orderId,
        payment_id: paymentId,
      },
      {
        order_id: orderId,
        payment_id: paymentId,
        order_status: "PAYMENT_VERIFIED",
        payment_status: "VERIFIED",
        verified_amount_minor: 9500,
        confirmed_at: "2026-09-05T12:05:00.000Z",
      },
    );
    expect(storedEvents[0].event_type).toBe("ORDER_CONFIRMED");
  });

  it("AUDIT-011: session audit returns only owned session history", async () => {
    storedEvents.push(
      {
        audit_event_id: "a1",
        event_type: "INTENT_RECEIVED",
        user_id: userA,
        session_id: sessionA,
        event_data_json: { intent_id: intentId },
        occurred_at: "2026-09-05T10:00:00.000Z",
      },
      {
        audit_event_id: "a2",
        event_type: "INTENT_RECEIVED",
        user_id: userB,
        session_id: sessionB,
        event_data_json: { intent_id: "other" },
        occurred_at: "2026-09-05T11:00:00.000Z",
      },
    );

    const audit = new AuditService();
    const trail = await audit.getSessionAuditTrail(userA, sessionA, userA);
    expect(trail.events).toHaveLength(1);
    expect(trail.events[0].user_id).toBe(userA);
  });

  it("AUDIT-013: audit records contain no secrets or payment signatures", () => {
    const sanitized = sanitizeAuditEventData({
      razorpay_order_id: "order_1",
      razorpay_signature: "must_be_stripped",
      razorpay_payment_id: "pay_1",
      webhook_secret: "shh",
      request_id: requestId,
    });
    expect(sanitized).not.toHaveProperty("razorpay_signature");
    expect(sanitized).not.toHaveProperty("webhook_secret");
    expect(sanitized.razorpay_order_id).toBe("order_1");
  });

  it("AUDIT-014: audit events are append-only (repository exposes create only)", () => {
    const repo = new AuditRepository();
    expect(typeof repo.createEvent).toBe("function");
    expect((repo as { updateEvent?: unknown }).updateEvent).toBeUndefined();
    expect((repo as { deleteEvent?: unknown }).deleteEvent).toBeUndefined();
  });

  it("AUDIT-015: correlation identifiers stay consistent through workflow", async () => {
    const audit = new AuditService();
    const ctx = {
      user_id: userA,
      session_id: sessionId,
      mandate_id: mandateId,
      basket_id: basketId,
      request_id: requestId,
    };
    await audit.recordBasketSelected(ctx, {
      selection_id: "sel-1",
      basket_id: basketId,
      selection_source: "USER",
    });
    await audit.recordRazorpayOrderCreated(
      { ...ctx, order_id: orderId, policy_decision_id: policyDecisionId },
      {
        order_id: orderId,
        razorpay_order_id: "order_rzp_1",
        authorized_amount_minor: 9500,
        currency: "INR",
        policy_decision_id: policyDecisionId,
      },
    );

    for (const event of storedEvents) {
      expect(event.session_id).toBe(sessionId);
      expect(event.mandate_id).toBe(mandateId);
      expect(
        (event.event_data_json as Record<string, unknown>).request_id,
      ).toBe(requestId);
    }
  });

  it("AUDIT-016: duplicate payment verification does not duplicate ORDER_CONFIRMED", async () => {
    const mockOrder: Order = {
      order_id: orderId,
      user_id: userA,
      session_id: sessionId,
      mandate_id: mandateId,
      basket_id: basketId,
      policy_decision_id: policyDecisionId,
      status: "PAYMENT_PENDING",
      gross_amount_minor: 9500,
      discount_amount_minor: 0,
      final_payable_minor: 9500,
      currency: "INR",
      razorpay_order_id: "order_rzp_1",
      created_at: "2026-09-05T12:00:00.000Z",
      updated_at: "2026-09-05T12:00:00.000Z",
    };
    const mockPayment: Payment = {
      payment_id: paymentId,
      order_id: orderId,
      razorpay_payment_id: "pay_rzp_1",
      status: "VERIFIED",
      amount_minor: 9500,
      currency: "INR",
      method: "card",
      verified_at: "2026-09-05T12:05:00.000Z",
      failure_code: null,
      metadata_json: {},
      created_at: "2026-09-05T12:00:00.000Z",
      updated_at: "2026-09-05T12:05:00.000Z",
    };

    const auditSpy = {
      recordPaymentVerifyRequested: vi.fn(),
      recordPaymentVerified: vi.fn(),
      recordPaymentFailed: vi.fn(),
      recordAmountMismatch: vi.fn(),
      recordOrderConfirmed: vi.fn(),
    };

    const service = new PaymentsService(
      {
        findOrderById: vi.fn().mockResolvedValue(mockOrder),
        findPaymentsByOrderId: vi.fn().mockResolvedValue([mockPayment]),
        verifyPaymentPersistenceAtomic: vi.fn(),
      } as never,
      {
        verifyPaymentSignature: vi.fn().mockReturnValue(true),
        fetchPayment: vi.fn(),
      } as never,
      auditSpy as never,
    );

    await service.verifyPayment({
      user_id: userA,
      order_id: orderId,
      razorpay_order_id: "order_rzp_1",
      razorpay_payment_id: "pay_rzp_1",
      razorpay_signature: "sig",
      request_id: requestId,
    });

    expect(auditSpy.recordPaymentVerified).not.toHaveBeenCalled();
    expect(auditSpy.recordOrderConfirmed).not.toHaveBeenCalled();
  });

  it("defines all required Phase 9 audit event types", () => {
    const required = [
      "INTENT_RECEIVED",
      "REQUIREMENTS_CREATED",
      "PRODUCT_RESEARCHED",
      "BASKET_CREATED",
      "VOUCHER_EVALUATED",
      "LOYALTY_EVALUATED",
      "BASKET_RECOMMENDED",
      "BASKET_SELECTED",
      "FRESH_QUOTE",
      "POLICY_ALLOW",
      "POLICY_DENY",
      "RAZORPAY_ORDER_CREATED",
      "PAYMENT_VERIFY_REQUESTED",
      "PAYMENT_VERIFIED",
      "PAYMENT_FAILED",
      "WEBHOOK_RECEIVED",
      "WEBHOOK_PROCESSED",
      "AMOUNT_MISMATCH",
      "ORDER_CONFIRMED",
    ];
    for (const type of required) {
      expect(AUDIT_EVENT_TYPES).toContain(type);
    }
  });
});

describe("GET /sessions/:session_id/audit (AUDIT-011, AUDIT-012)", () => {
  it("AUDIT-012: cross-user audit access is rejected", async () => {
    const { AuditController } = await import(
      "../../src/modules/audit/controller.js"
    );

    const controller = new AuditController(
      { getSessionAuditTrail: vi.fn() } as never,
      {
        findById: vi.fn().mockResolvedValue({
          session_id: sessionB,
          user_id: userB,
          status: "ACTIVE",
        }),
      } as never,
    );

    const req = {
      user: { id: userA },
      params: { session_id: sessionB },
      requestId: "req-cross-user-audit",
    } as never;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as never;

    await expect(
      controller.listSessionAudit(req, res),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
