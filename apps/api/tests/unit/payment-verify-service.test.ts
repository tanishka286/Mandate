import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentsService } from "../../src/modules/payments/service.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import type { PaymentsRepository } from "../../src/modules/payments/repository.js";
import type { RazorpayServerAdapter } from "../../src/modules/payments/razorpay-adapter.js";
import type { Order, Payment } from "../../src/modules/payments/types.js";

describe("PaymentsService.verifyPayment (Phase 8 Step 6)", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const otherUserId = "99999999-9999-4999-8999-999999999999";
  const orderId = "22222222-2222-4222-8222-222222222222";
  const paymentId = "33333333-3333-4333-8333-333333333333";
  const razorpayOrderId = "order_rzp_test_123456";
  const razorpayPaymentId = "pay_rzp_test_789012";
  const razorpaySignature = "valid_hex_signature_sample_abc123";
  const authorizedAmountMinor = 5500; // ₹55.00

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

    service = new PaymentsService(
      mockPaymentsRepo as unknown as PaymentsRepository,
      mockRazorpayAdapter as unknown as RazorpayServerAdapter,
    );
  });

  // ---------------------------------------------------------------------------
  // Scenario 1: Valid Verification (Happy Path: PAYMENT_PENDING -> VERIFIED)
  // ---------------------------------------------------------------------------
  it("Scenario 1: Happy path successfully transitions PAYMENT_PENDING to VERIFIED", async () => {
    const result = await service.verifyPayment({
      user_id: userId,
      order_id: orderId,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    });

    expect(result.status).toBe("VERIFIED");
    expect(result.order_id).toBe(orderId);
    expect(result.payment_id).toBe(paymentId);
    expect(result.razorpay_payment_id).toBe(razorpayPaymentId);
    expect(result.amount_minor).toBe(authorizedAmountMinor);
    expect(result.verified_at).toBeDefined();

    expect(mockRazorpayAdapter.verifyPaymentSignature).toHaveBeenCalledWith({
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    });
    expect(mockRazorpayAdapter.fetchPayment).toHaveBeenCalledWith(razorpayPaymentId);
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Invalid Signature (Fail Closed)
  // ---------------------------------------------------------------------------
  it("Scenario 2: Invalid cryptographic signature fails closed and does not mutate state", async () => {
    mockRazorpayAdapter.verifyPaymentSignature.mockReturnValue(false);

    let error: unknown;
    try {
      await service.verifyPayment({
        user_id: userId,
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: "bad_signature_attempt",
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe("PAYMENT_SIGNATURE_INVALID");
    expect(appErr.statusCode).toBe(400);
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Wrong Authenticated User (Cross-User Forbidden)
  // ---------------------------------------------------------------------------
  it("Scenario 3: Wrong authenticated user is rejected with 403 FORBIDDEN without mutation", async () => {
    let error: unknown;
    try {
      await service.verifyPayment({
        user_id: otherUserId, // Cross-user caller
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe(ErrorCodes.FORBIDDEN);
    expect(appErr.statusCode).toBe(403);
    expect(mockRazorpayAdapter.verifyPaymentSignature).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Razorpay Order ID Mismatch
  // ---------------------------------------------------------------------------
  it("Scenario 4: Submitted Razorpay order ID mismatch is rejected without mutation", async () => {
    let error: unknown;
    try {
      await service.verifyPayment({
        user_id: userId,
        order_id: orderId,
        razorpay_order_id: "order_rzp_different_order_999",
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(appErr.statusCode).toBe(400);
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Razorpay Payment/Order Relationship Mismatch
  // ---------------------------------------------------------------------------
  it("Scenario 5: Provider payment belonging to different order is rejected", async () => {
    mockRazorpayAdapter.fetchPayment.mockResolvedValueOnce({
      razorpay_payment_id: razorpayPaymentId,
      razorpay_order_id: "order_rzp_unrelated_order_555",
      amount: authorizedAmountMinor,
      currency: "INR",
      status: "captured",
      method: "card",
    });

    let error: unknown;
    try {
      await service.verifyPayment({
        user_id: userId,
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe("PAYMENT_PROVIDER_ORDER_MISMATCH");
    expect(appErr.statusCode).toBe(400);
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Payment Amount Mismatch (Critical Financial Invariant)
  // ---------------------------------------------------------------------------
  it("Scenario 6: Payment amount mismatch fails closed with 422 PAYMENT_AMOUNT_MISMATCH", async () => {
    mockRazorpayAdapter.fetchPayment.mockResolvedValueOnce({
      razorpay_payment_id: razorpayPaymentId,
      razorpay_order_id: razorpayOrderId,
      amount: 4000, // ₹40.00 instead of ₹55.00
      currency: "INR",
      status: "captured",
      method: "upi",
    });

    let error: unknown;
    try {
      await service.verifyPayment({
        user_id: userId,
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe("PAYMENT_AMOUNT_MISMATCH");
    expect(appErr.statusCode).toBe(422);
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: Currency Mismatch
  // ---------------------------------------------------------------------------
  it("Scenario 7: Provider currency mismatch fails closed with 422 PAYMENT_CURRENCY_MISMATCH", async () => {
    mockRazorpayAdapter.fetchPayment.mockResolvedValueOnce({
      razorpay_payment_id: razorpayPaymentId,
      razorpay_order_id: razorpayOrderId,
      amount: authorizedAmountMinor,
      currency: "USD",
      status: "captured",
      method: "card",
    });

    let error: unknown;
    try {
      await service.verifyPayment({
        user_id: userId,
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe("PAYMENT_CURRENCY_MISMATCH");
    expect(appErr.statusCode).toBe(422);
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: Provider Lookup Timeout
  // ---------------------------------------------------------------------------
  it("Scenario 8: Provider timeout propagates safe error without false VERIFIED", async () => {
    mockRazorpayAdapter.fetchPayment.mockRejectedValueOnce(
      new AppError({
        code: "PAYMENT_PROVIDER_TIMEOUT",
        message: "Payment provider request timed out",
        statusCode: 504,
      }),
    );

    let error: unknown;
    try {
      await service.verifyPayment({
        user_id: userId,
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe("PAYMENT_PROVIDER_TIMEOUT");
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 9: Provider Failure
  // ---------------------------------------------------------------------------
  it("Scenario 9: Provider failure propagates safe error without false VERIFIED", async () => {
    mockRazorpayAdapter.fetchPayment.mockRejectedValueOnce(
      new AppError({
        code: "PAYMENT_PROVIDER_ERROR",
        message: "Payment provider internal error",
        statusCode: 502,
      }),
    );

    let error: unknown;
    try {
      await service.verifyPayment({
        user_id: userId,
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe("PAYMENT_PROVIDER_ERROR");
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 10: Idempotent Compatible Retry (Already VERIFIED)
  // ---------------------------------------------------------------------------
  it("Scenario 10: Already VERIFIED with compatible identifiers returns existing verified result", async () => {
    const verifiedPayment: Payment = {
      ...mockPayment,
      status: "VERIFIED",
      razorpay_payment_id: razorpayPaymentId,
      verified_at: "2026-09-05T12:05:00.000Z",
    };
    mockPaymentsRepo.findPaymentsByOrderId.mockResolvedValueOnce([verifiedPayment]);

    const result = await service.verifyPayment({
      user_id: userId,
      order_id: orderId,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    });

    expect(result.status).toBe("VERIFIED");
    expect(result.payment_id).toBe(paymentId);
    expect(result.razorpay_payment_id).toBe(razorpayPaymentId);
    expect(result.verified_at).toBe("2026-09-05T12:05:00.000Z");

    // Adapter fetchPayment and DB mutation are skipped on compatible replay
    expect(mockRazorpayAdapter.fetchPayment).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 11: Already VERIFIED + Conflicting Provider Identifiers
  // ---------------------------------------------------------------------------
  it("Scenario 11: Already VERIFIED with conflicting identifiers is rejected with 409 CONFLICT", async () => {
    const verifiedPayment: Payment = {
      ...mockPayment,
      status: "VERIFIED",
      razorpay_payment_id: razorpayPaymentId, // pay_rzp_test_789012
      verified_at: "2026-09-05T12:05:00.000Z",
    };
    mockPaymentsRepo.findPaymentsByOrderId.mockResolvedValueOnce([verifiedPayment]);

    let error: unknown;
    try {
      await service.verifyPayment({
        user_id: userId,
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: "pay_rzp_conflicting_payment_999",
        razorpay_signature: razorpaySignature,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe(ErrorCodes.CONFLICT);
    expect(appErr.statusCode).toBe(409);
    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 12: Invalid State Transitions (Terminal States)
  // ---------------------------------------------------------------------------
  it("Scenario 12: Incompatible payment terminal states (FAILED, CANCELLED, EXPIRED) reject verification", async () => {
    const terminalStates: Array<"FAILED" | "CANCELLED" | "EXPIRED"> = [
      "FAILED",
      "CANCELLED",
      "EXPIRED",
    ];

    for (const state of terminalStates) {
      const invalidPayment: Payment = {
        ...mockPayment,
        status: state,
      };
      mockPaymentsRepo.findPaymentsByOrderId.mockResolvedValueOnce([invalidPayment]);

      let error: unknown;
      try {
        await service.verifyPayment({
          user_id: userId,
          order_id: orderId,
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: razorpaySignature,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(AppError);
      const appErr = error as AppError;
      expect(appErr.code).toBe(ErrorCodes.CONFLICT);
      expect(appErr.statusCode).toBe(409);
      expect(appErr.message).toContain(`Illegal payment state transition: ${state} → VERIFIED`);
    }

    expect(mockPaymentsRepo.verifyPaymentPersistenceAtomic).not.toHaveBeenCalled();
  });
});
