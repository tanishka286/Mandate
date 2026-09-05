import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentsService } from "../../src/modules/payments/service.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { AuditRepository } from "../../src/modules/audit/repository.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import type { PaymentsRepository } from "../../src/modules/payments/repository.js";
import type { RazorpayServerAdapter } from "../../src/modules/payments/razorpay-adapter.js";
import type { Order, Payment } from "../../src/modules/payments/types.js";

const RAZORPAY_SIGNATURE = "valid_hex_signature_sample_abc123";
const RAZORPAY_KEY_SECRET = "secret_super_confidential_razorpay_key_audit";
const REQUEST_ID = "req-audit-verify-001";

describe("PaymentsService payment verification audit events (Phase 8 Step 6)", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const orderId = "22222222-2222-4222-8222-222222222222";
  const paymentId = "33333333-3333-4333-8333-333333333333";
  const razorpayOrderId = "order_rzp_test_123456";
  const razorpayPaymentId = "pay_rzp_test_789012";
  const authorizedAmountMinor = 5500;

  let mockOrder: Order;
  let mockPayment: Payment;

  let mockPaymentsRepo: {
    findOrderById: ReturnType<typeof vi.fn>;
    findPaymentsByOrderId: ReturnType<typeof vi.fn>;
    verifyPaymentPersistenceAtomic: ReturnType<typeof vi.fn>;
  };

  let mockRazorpayAdapter: {
    verifyPaymentSignature: ReturnType<typeof vi.fn>;
    fetchPayment: ReturnType<typeof vi.fn>;
  };

  let auditSpy: {
    recordPaymentVerifyRequested: ReturnType<typeof vi.fn>;
    recordPaymentVerified: ReturnType<typeof vi.fn>;
    recordPaymentFailed: ReturnType<typeof vi.fn>;
    recordAmountMismatch: ReturnType<typeof vi.fn>;
    recordOrderConfirmed: ReturnType<typeof vi.fn>;
  };

  let service: PaymentsService;

  beforeEach(() => {
    mockOrder = {
      order_id: orderId,
      user_id: userId,
      session_id: "44444444-4444-4444-8444-444444444444",
      mandate_id: "55555555-5555-4555-8555-555555555555",
      basket_id: "66666666-6666-4666-8666-666666666666",
      policy_decision_id: "77777777-7777-4777-8777-777777777777",
      status: "PAYMENT_PENDING",
      gross_amount_minor: authorizedAmountMinor,
      discount_amount_minor: 0,
      final_payable_minor: authorizedAmountMinor,
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
      amount_minor: authorizedAmountMinor,
      currency: "INR",
      method: null,
      verified_at: null,
      failure_code: null,
      metadata_json: {},
      created_at: "2026-09-05T12:00:00.000Z",
      updated_at: "2026-09-05T12:00:00.000Z",
    };

    mockPaymentsRepo = {
      findOrderById: vi.fn().mockResolvedValue(mockOrder),
      findPaymentsByOrderId: vi.fn().mockResolvedValue([mockPayment]),
      verifyPaymentPersistenceAtomic: vi.fn().mockImplementation(async (input) => ({
        order: { ...mockOrder, status: "PAYMENT_VERIFIED" },
        payment: {
          ...mockPayment,
          status: "VERIFIED",
          razorpay_payment_id: input.razorpay_payment_id,
          verified_at: input.verified_at,
          method: input.method ?? "upi",
        },
        replayed: false,
      })),
    };

    mockRazorpayAdapter = {
      verifyPaymentSignature: vi.fn().mockReturnValue(true),
      fetchPayment: vi.fn().mockResolvedValue({
        razorpay_payment_id: razorpayPaymentId,
        razorpay_order_id: razorpayOrderId,
        amount: authorizedAmountMinor,
        currency: "INR",
        status: "captured",
        method: "upi",
      }),
    };

    auditSpy = {
      recordPaymentVerifyRequested: vi.fn().mockResolvedValue(undefined),
      recordPaymentVerified: vi.fn().mockResolvedValue(undefined),
      recordPaymentFailed: vi.fn().mockResolvedValue(undefined),
      recordAmountMismatch: vi.fn().mockResolvedValue(undefined),
      recordOrderConfirmed: vi.fn().mockResolvedValue(undefined),
    };

    service = new PaymentsService(
      mockPaymentsRepo as unknown as PaymentsRepository,
      mockRazorpayAdapter as unknown as RazorpayServerAdapter,
      auditSpy as unknown as AuditService,
    );
  });

  const baseInput = {
    user_id: userId,
    order_id: orderId,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: RAZORPAY_SIGNATURE,
    request_id: REQUEST_ID,
  };

  it("emits PAYMENT_VERIFY_REQUESTED with safe correlation identifiers", async () => {
    await service.verifyPayment(baseInput);

    expect(auditSpy.recordPaymentVerifyRequested).toHaveBeenCalledTimes(1);
    expect(auditSpy.recordPaymentVerifyRequested).toHaveBeenCalledWith(
      {
        user_id: userId,
        session_id: mockOrder.session_id,
        mandate_id: mockOrder.mandate_id,
        basket_id: mockOrder.basket_id,
        policy_decision_id: mockOrder.policy_decision_id,
        order_id: orderId,
        payment_id: paymentId,
        request_id: REQUEST_ID,
      },
      {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
      },
    );
  });

  it("emits PAYMENT_VERIFIED only after successful persistence", async () => {
    await service.verifyPayment(baseInput);

    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).toHaveBeenCalledTimes(1);
    expect(auditSpy.recordPaymentVerified).toHaveBeenCalledTimes(1);
    expect(auditSpy.recordPaymentVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: orderId,
        payment_id: paymentId,
        request_id: REQUEST_ID,
      }),
      expect.objectContaining({
        razorpay_payment_id: razorpayPaymentId,
        amount_minor: authorizedAmountMinor,
        verified_at: expect.any(String),
      }),
    );
  });

  it("does not emit PAYMENT_VERIFIED on idempotent compatible replay", async () => {
    const verifiedPayment: Payment = {
      ...mockPayment,
      status: "VERIFIED",
      razorpay_payment_id: razorpayPaymentId,
      verified_at: "2026-09-05T12:05:00.000Z",
    };
    mockPaymentsRepo.findPaymentsByOrderId.mockResolvedValueOnce([verifiedPayment]);

    await service.verifyPayment(baseInput);

    expect(auditSpy.recordPaymentVerifyRequested).toHaveBeenCalledTimes(1);
    expect(auditSpy.recordPaymentVerified).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  it("emits PAYMENT_FAILED for invalid signature verification", async () => {
    mockRazorpayAdapter.verifyPaymentSignature.mockReturnValue(false);

    await expect(service.verifyPayment(baseInput)).rejects.toBeInstanceOf(AppError);

    expect(auditSpy.recordPaymentFailed).toHaveBeenCalledTimes(1);
    expect(auditSpy.recordPaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: orderId, payment_id: paymentId }),
      expect.objectContaining({
        failure_code: "PAYMENT_SIGNATURE_INVALID",
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
      }),
    );
    expect(auditSpy.recordPaymentVerified).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  it("emits AMOUNT_MISMATCH for provider amount mismatch and never PAYMENT_VERIFIED", async () => {
    mockRazorpayAdapter.fetchPayment.mockResolvedValueOnce({
      razorpay_payment_id: razorpayPaymentId,
      razorpay_order_id: razorpayOrderId,
      amount: 4000,
      currency: "INR",
      status: "captured",
      method: "upi",
    });

    let error: unknown;
    try {
      await service.verifyPayment(baseInput);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("PAYMENT_AMOUNT_MISMATCH");
    expect(auditSpy.recordAmountMismatch).toHaveBeenCalledTimes(1);
    expect(auditSpy.recordAmountMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: orderId, payment_id: paymentId }),
      {
        expected_amount_minor: authorizedAmountMinor,
        observed_amount_minor: 4000,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
      },
    );
    expect(auditSpy.recordPaymentFailed).not.toHaveBeenCalled();
    expect(auditSpy.recordPaymentVerified).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  it("emits PAYMENT_FAILED for provider lookup failure", async () => {
    mockRazorpayAdapter.fetchPayment.mockRejectedValueOnce(
      new AppError({
        code: "PAYMENT_PROVIDER_TIMEOUT",
        message: "Payment provider request timed out",
        statusCode: 504,
      }),
    );

    await expect(service.verifyPayment(baseInput)).rejects.toBeInstanceOf(AppError);

    expect(auditSpy.recordPaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: orderId, payment_id: paymentId }),
      expect.objectContaining({ failure_code: "PAYMENT_PROVIDER_TIMEOUT" }),
    );
    expect(auditSpy.recordPaymentVerified).not.toHaveBeenCalled();
  });

  it("does not emit PAYMENT_VERIFY_REQUESTED before order ownership validation", async () => {
    await expect(
      service.verifyPayment({
        ...baseInput,
        user_id: "99999999-9999-4999-8999-999999999999",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN });

    expect(auditSpy.recordPaymentVerifyRequested).not.toHaveBeenCalled();
    expect(auditSpy.recordPaymentVerified).not.toHaveBeenCalled();
  });

  it("never records secrets or signatures in audit payloads", async () => {
    await service.verifyPayment({
      ...baseInput,
      razorpay_signature: RAZORPAY_SIGNATURE,
    });

    const allAuditCalls = [
      ...auditSpy.recordPaymentVerifyRequested.mock.calls,
      ...auditSpy.recordPaymentVerified.mock.calls,
      ...auditSpy.recordPaymentFailed.mock.calls,
      ...auditSpy.recordAmountMismatch.mock.calls,
    ];

    const serialized = JSON.stringify(allAuditCalls);
    expect(serialized).not.toContain(RAZORPAY_SIGNATURE);
    expect(serialized).not.toContain(RAZORPAY_KEY_SECRET);
    expect(serialized).not.toContain("razorpay_signature");
    expect(serialized).not.toContain("key_secret");
    expect(serialized).not.toContain("webhook_secret");
  });

  it("does not fail verification when audit persistence fails", async () => {
    const mockAuditRepo = {
      createEvent: vi.fn().mockRejectedValue(new Error("audit database unavailable")),
    };
    const failingAuditService = new AuditService(
      mockAuditRepo as unknown as AuditRepository,
    );

    const resilientService = new PaymentsService(
      mockPaymentsRepo as unknown as PaymentsRepository,
      mockRazorpayAdapter as unknown as RazorpayServerAdapter,
      failingAuditService,
    );

    const result = await resilientService.verifyPayment(baseInput);

    expect(result.status).toBe("VERIFIED");
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).toHaveBeenCalledTimes(1);
  });
});
