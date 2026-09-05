import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentsRepository } from "../../src/modules/payments/repository.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import * as supabaseModule from "../../src/config/supabase.js";

describe("PaymentsRepository.createCheckoutPersistenceAtomic (Phase 8 Step 4A)", () => {
  let mockRpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRpc = vi.fn();
    vi.spyOn(supabaseModule, "getSupabaseClient").mockReturnValue({
      rpc: mockRpc,
    } as never);
  });

  const validAtomicInput = {
    order_id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    session_id: "33333333-3333-4333-8333-333333333333",
    mandate_id: "44444444-4444-4444-8444-444444444444",
    basket_id: "55555555-5555-4555-8555-555555555555",
    policy_decision_id: "66666666-6666-4666-8666-666666666666",
    gross_amount_minor: 5000,
    discount_amount_minor: 500,
    final_payable_minor: 4500,
    payment_amount_minor: 4500,
    idempotency_key: "idem-atomic-unit-1",
    request_fingerprint: "fingerprint-unit-1",
    response_json: { test: "data" },
    razorpay_order_id: "order_rzp_mock_1",
  };

  it("calls the hosted Supabase RPC create_checkout_persistence_atomic exactly once with correct parameters", async () => {
    mockRpc.mockResolvedValue({
      data: {
        order: {
          order_id: validAtomicInput.order_id,
          user_id: validAtomicInput.user_id,
          session_id: validAtomicInput.session_id,
          mandate_id: validAtomicInput.mandate_id,
          basket_id: validAtomicInput.basket_id,
          policy_decision_id: validAtomicInput.policy_decision_id,
          status: "PAYMENT_PENDING",
          gross_amount_minor: "5000",
          discount_amount_minor: "500",
          final_payable_minor: "4500",
          currency: "INR",
          razorpay_order_id: "order_rzp_mock_1",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        payment: {
          payment_id: "pay-123",
          order_id: validAtomicInput.order_id,
          razorpay_payment_id: null,
          status: "PAYMENT_PENDING",
          amount_minor: "4500",
          currency: "INR",
          method: null,
          verified_at: null,
          failure_code: null,
          metadata_json: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        idempotency: {
          idempotency_id: "idem-123",
          user_id: validAtomicInput.user_id,
          idempotency_key: validAtomicInput.idempotency_key,
          request_fingerprint: validAtomicInput.request_fingerprint,
          order_id: validAtomicInput.order_id,
          response_json: validAtomicInput.response_json,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        replayed: false,
      },
      error: null,
    });

    const repo = new PaymentsRepository();
    const result = await repo.createCheckoutPersistenceAtomic(validAtomicInput);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("create_checkout_persistence_atomic", {
      p_order_id: validAtomicInput.order_id,
      p_user_id: validAtomicInput.user_id,
      p_session_id: validAtomicInput.session_id,
      p_mandate_id: validAtomicInput.mandate_id,
      p_basket_id: validAtomicInput.basket_id,
      p_policy_decision_id: validAtomicInput.policy_decision_id,
      p_gross_amount_minor: 5000,
      p_discount_amount_minor: 500,
      p_final_payable_minor: 4500,
      p_payment_amount_minor: 4500,
      p_idempotency_key: "idem-atomic-unit-1",
      p_request_fingerprint: "fingerprint-unit-1",
      p_response_json: { test: "data" },
      p_razorpay_order_id: "order_rzp_mock_1",
      p_payment_id: null,
      p_currency: "INR",
      p_order_status: "PAYMENT_PENDING",
      p_payment_status: "PAYMENT_PENDING",
    });

    expect(result.replayed).toBe(false);
    expect(result.order.order_id).toBe(validAtomicInput.order_id);
    expect(result.order.final_payable_minor).toBe(4500);
    expect(result.payment.amount_minor).toBe(4500);
    expect(result.idempotency.idempotency_key).toBe("idem-atomic-unit-1");
  });

  it("maps IDEMPOTENCY_CONFLICT error message from RPC to structured 409 conflict AppError", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: "IDEMPOTENCY_CONFLICT: Idempotency-Key was reused with a different request fingerprint",
        code: "P0001",
      },
    });

    const repo = new PaymentsRepository();

    try {
      await repo.createCheckoutPersistenceAtomic(validAtomicInput);
      expect.unreachable("Should have failed with IDEMPOTENCY_CONFLICT");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe(ErrorCodes.IDEMPOTENCY_CONFLICT);
      expect(appErr.statusCode).toBe(409);
    }
  });

  it("maps generic database RPC errors via mapDatabaseError", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: "connection timeout",
        code: "57P01",
      },
    });

    const repo = new PaymentsRepository();
    await expect(
      repo.createCheckoutPersistenceAtomic(validAtomicInput),
    ).rejects.toThrowError(AppError);
  });
});
