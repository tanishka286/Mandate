import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckoutService } from "../../src/modules/checkout/service.js";
import { buildCheckoutFingerprint } from "../../src/modules/payments/fingerprint.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import type { PolicyEvaluationResult } from "../../src/modules/policy/schema.js";

describe("CheckoutService (Phase 8 Step 4)", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const selectionId = "33333333-3333-4333-8333-333333333333";
  const basketId = "44444444-4444-4444-8444-444444444444";
  const mandateId = "55555555-5555-4555-8555-555555555555";
  const policyDecisionId = "66666666-6666-4666-8666-666666666666";
  const idempotencyKey = "idem-checkout-test-123";

  let defaultFixtures: {
    selection: Record<string, unknown>;
    basket: Record<string, unknown>;
    policyDecision: Record<string, unknown>;
  };

  type MockDb = {
    from: ReturnType<typeof vi.fn>;
  };

  let mockPaymentsRepo: {
    findCheckoutIdempotency: ReturnType<typeof vi.fn>;
    createCheckoutIdempotency: ReturnType<typeof vi.fn>;
    createOrder: ReturnType<typeof vi.fn>;
    createPayment: ReturnType<typeof vi.fn>;
  };
  let mockBasketService: {
    createFreshQuote: ReturnType<typeof vi.fn>;
  };
  let mockPolicyRevalidation: {
    revalidate: ReturnType<typeof vi.fn>;
  };
  let mockRazorpayAdapter: {
    createRazorpayOrder: ReturnType<typeof vi.fn>;
  };
  let mockDb: MockDb;

  function createMockDb(fixtures: typeof defaultFixtures): MockDb {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        let row: Record<string, unknown> | null = null;
        if (table === "basket_selection") row = fixtures.selection;
        if (table === "basket") row = fixtures.basket;
        if (table === "policy_decision") row = fixtures.policyDecision;

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
        };
      }),
    };
  }

  beforeEach(() => {
    defaultFixtures = {
      selection: {
        selection_id: selectionId,
        session_id: sessionId,
        basket_id: basketId,
        user_id: userId,
        selection_source: "USER",
        selected_at: new Date().toISOString(),
        superseded_at: null,
      },
      basket: {
        basket_id: basketId,
        session_id: sessionId,
        user_id: userId,
        status: "CURRENT",
        optimization_run_id: "run-123",
        state_version: 1,
      },
      policyDecision: {
        policy_decision_id: policyDecisionId,
        mandate_id: mandateId,
        basket_id: basketId,
        user_id: userId,
        decision: "ALLOW",
      },
    };

    mockPaymentsRepo = {
      findCheckoutIdempotency: vi.fn().mockResolvedValue(null),
      createCheckoutIdempotency: vi.fn().mockResolvedValue({}),
      createOrder: vi.fn(),
      createPayment: vi.fn(),
      createCheckoutPersistenceAtomic: vi.fn().mockImplementation(async (input) => ({
        order: {
          order_id: input.order_id,
          user_id: input.user_id,
          session_id: input.session_id,
          mandate_id: input.mandate_id,
          basket_id: input.basket_id,
          policy_decision_id: input.policy_decision_id,
          status: "PAYMENT_PENDING",
          gross_amount_minor: input.gross_amount_minor,
          discount_amount_minor: input.discount_amount_minor,
          final_payable_minor: input.final_payable_minor,
          currency: "INR",
          razorpay_order_id: input.razorpay_order_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        payment: {
          payment_id: "payment-created-123",
          order_id: input.order_id,
          status: "PAYMENT_PENDING",
          amount_minor: input.payment_amount_minor,
          currency: "INR",
          razorpay_payment_id: null,
          method: null,
          verified_at: null,
          failure_code: null,
          metadata_json: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        idempotency: {
          idempotency_id: "idem-created-123",
          user_id: input.user_id,
          idempotency_key: input.idempotency_key,
          request_fingerprint: input.request_fingerprint,
          order_id: input.order_id,
          response_json: input.response_json,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        replayed: false,
      })),
    };

    mockBasketService = {
      createFreshQuote: vi.fn().mockResolvedValue({
        quote_id: "quote-fresh-1",
        quote_version: "qv-2.0.0",
        final_payable_minor: 4500,
        gross_amount_minor: 5000,
        discount_amount_minor: 500,
        currency: "INR",
        basket_state_version: 1,
      }),
    };

    const allowResult: PolicyEvaluationResult = {
      decision: "ALLOW",
      reason_code: "AUTHORIZED",
      message: null,
      recoverable: false,
      policy_decision_id: "pol-fresh-allow-777",
      policy_version: "1.0",
      mandate_id: mandateId,
      basket_id: basketId,
      gross_amount_minor: 5000,
      discount_amount_minor: 500,
      final_payable_minor: 4500,
      max_spend_minor: 10000,
      evaluated_at: new Date().toISOString(),
      request_id: "req-123",
    };

    mockPolicyRevalidation = {
      revalidate: vi.fn().mockResolvedValue(allowResult),
    };

    mockRazorpayAdapter = {
      createRazorpayOrder: vi.fn().mockResolvedValue({
        razorpay_order_id: "order_rzp_mock_999",
        amount: 4500,
        currency: "INR",
        receipt: "rcpt_mock_receipt",
        status: "created",
      }),
    };

    mockDb = createMockDb(defaultFixtures);
  });

  function createService() {
    const mockAuditService = {
      recordRazorpayOrderCreated: vi.fn().mockResolvedValue(undefined),
    };
    return new CheckoutService(
      mockPaymentsRepo as never,
      mockBasketService as never,
      mockPolicyRevalidation as never,
      mockRazorpayAdapter as never,
      mockAuditService as never,
      mockDb as never,
    );
  }

  const validCheckoutInput = {
    user_id: userId,
    session_id: sessionId,
    selection_id: selectionId,
    policy_decision_id: policyDecisionId,
    idempotency_key: idempotencyKey,
    request_id: "req-unit-1",
  };

  // 1. Authenticated valid selection + fresh ALLOW -> Razorpay adapter called exactly once
  it("1. calls Razorpay adapter exactly once on authenticated valid selection + fresh ALLOW", async () => {
    const service = createService();
    const result = await service.checkout(validCheckoutInput);

    expect(mockRazorpayAdapter.createRazorpayOrder).toHaveBeenCalledTimes(1);
    expect(result.razorpay_order_id).toBe("order_rzp_mock_999");
    expect(result.amount_minor).toBe(4500);
    expect(result.currency).toBe("INR");
    expect(result.status).toBe("PAYMENT_PENDING");
  });

  // 2. Policy DENY -> Razorpay adapter NOT called
  it("2. does NOT call Razorpay adapter on Policy DENY", async () => {
    mockPolicyRevalidation.revalidate.mockResolvedValue({
      decision: "DENY",
      reason_code: "CATEGORY_NOT_ALLOWED",
      message: "Category produce is not allowed by mandate",
      recoverable: false,
      policy_decision_id: "pol-deny-1",
      policy_version: "1.0",
      mandate_id: mandateId,
      basket_id: basketId,
      gross_amount_minor: 5000,
      discount_amount_minor: 0,
      final_payable_minor: 5000,
      max_spend_minor: 10000,
      evaluated_at: new Date().toISOString(),
      request_id: "req-123",
    });

    const service = createService();

    await expect(service.checkout(validCheckoutInput)).rejects.toThrowError(
      AppError,
    );
    expect(mockRazorpayAdapter.createRazorpayOrder).not.toHaveBeenCalled();
    expect(
      mockPaymentsRepo.createCheckoutPersistenceAtomic,
    ).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createOrder).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createPayment).not.toHaveBeenCalled();
  });

  // 3. MAX_SPEND_EXCEEDED -> no order/payment/provider order
  it("3. rejects with MAX_SPEND_EXCEEDED and creates no order/payment/provider order", async () => {
    mockPolicyRevalidation.revalidate.mockResolvedValue({
      decision: "DENY",
      reason_code: "MAX_SPEND_EXCEEDED",
      message: "Total exceeds mandate max spend",
      recoverable: false,
      policy_decision_id: "pol-deny-max-spend",
      policy_version: "1.0",
      mandate_id: mandateId,
      basket_id: basketId,
      gross_amount_minor: 15000,
      discount_amount_minor: 0,
      final_payable_minor: 15000,
      max_spend_minor: 10000,
      evaluated_at: new Date().toISOString(),
      request_id: "req-123",
    });

    const service = createService();

    try {
      await service.checkout(validCheckoutInput);
      expect.unreachable("Should have failed");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe("MAX_SPEND_EXCEEDED");
      expect(appErr.statusCode).toBe(422);
    }

    expect(mockRazorpayAdapter.createRazorpayOrder).not.toHaveBeenCalled();
    expect(
      mockPaymentsRepo.createCheckoutPersistenceAtomic,
    ).not.toHaveBeenCalled();
  });

  // 4. Expired mandate -> no provider order
  it("4. rejects on expired or invalid mandate without creating provider order", async () => {
    mockPolicyRevalidation.revalidate.mockResolvedValue({
      decision: "DENY",
      reason_code: "MANDATE_INVALID",
      message: "Mandate is expired",
      recoverable: false,
      policy_decision_id: "pol-deny-mandate-expired",
      policy_version: "1.0",
      mandate_id: mandateId,
      basket_id: basketId,
      gross_amount_minor: 5000,
      discount_amount_minor: 0,
      final_payable_minor: 5000,
      max_spend_minor: 10000,
      evaluated_at: new Date().toISOString(),
      request_id: "req-123",
    });

    const service = createService();

    try {
      await service.checkout(validCheckoutInput);
      expect.unreachable("Should have failed");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe("MANDATE_INVALID");
      expect(appErr.statusCode).toBe(422);
    }

    expect(mockRazorpayAdapter.createRazorpayOrder).not.toHaveBeenCalled();
  });

  // 5. Cross-user selection -> rejected; no provider order
  it("5. rejects cross-user selection and creates no provider order", async () => {
    defaultFixtures.selection.user_id = "other-user-4444-4444-4444";
    mockDb = createMockDb(defaultFixtures);

    const service = createService();

    try {
      await service.checkout(validCheckoutInput);
      expect.unreachable("Should have failed");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe(ErrorCodes.FORBIDDEN);
      expect(appErr.statusCode).toBe(403);
    }

    expect(mockRazorpayAdapter.createRazorpayOrder).not.toHaveBeenCalled();
  });

  // 6. Previous/stale ALLOW -> revalidation occurs; stale authorization cannot be reused
  it("6. always performs fresh policy revalidation and ignores prior ALLOW decision", async () => {
    // previousPolicyDecision was ALLOW, but fresh revalidation returns DENY
    mockPolicyRevalidation.revalidate.mockResolvedValue({
      decision: "DENY",
      reason_code: "STOCK_UNAVAILABLE",
      message: "Stock ran out",
      recoverable: false,
      policy_decision_id: "pol-fresh-deny",
      policy_version: "1.0",
      mandate_id: mandateId,
      basket_id: basketId,
      gross_amount_minor: 5000,
      discount_amount_minor: 0,
      final_payable_minor: 5000,
      max_spend_minor: 10000,
      evaluated_at: new Date().toISOString(),
      request_id: "req-123",
    });

    const service = createService();

    await expect(service.checkout(validCheckoutInput)).rejects.toThrowError(
      AppError,
    );
    expect(mockPolicyRevalidation.revalidate).toHaveBeenCalledTimes(1);
    expect(mockRazorpayAdapter.createRazorpayOrder).not.toHaveBeenCalled();
  });

  // 7. Fresh quote amount is used
  it("7. uses fresh quote amount for revalidation and provider order", async () => {
    mockBasketService.createFreshQuote.mockResolvedValue({
      quote_id: "quote-fresh-2",
      quote_version: "qv-3.0.0",
      final_payable_minor: 7200,
      gross_amount_minor: 8000,
      discount_amount_minor: 800,
      currency: "INR",
    });

    mockPolicyRevalidation.revalidate.mockResolvedValue({
      decision: "ALLOW",
      reason_code: "AUTHORIZED",
      message: null,
      recoverable: false,
      policy_decision_id: "pol-fresh-7200",
      policy_version: "1.0",
      mandate_id: mandateId,
      basket_id: basketId,
      gross_amount_minor: 8000,
      discount_amount_minor: 800,
      final_payable_minor: 7200,
      max_spend_minor: 10000,
      evaluated_at: new Date().toISOString(),
      request_id: "req-123",
    });

    const service = createService();
    const result = await service.checkout(validCheckoutInput);

    expect(mockRazorpayAdapter.createRazorpayOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount_minor: 7200 }),
    );
    expect(result.amount_minor).toBe(7200);
  });

  // 8. Client-supplied amount is ignored/rejected because checkout service does not accept it
  it("8. rejects any input attempting to supply a client amount", async () => {
    const service = createService();

    const inputWithClientAmount = {
      ...validCheckoutInput,
      amount: 1000,
      final_payable_minor: 1000,
    };

    await expect(service.checkout(inputWithClientAmount)).rejects.toThrowError();
    expect(mockRazorpayAdapter.createRazorpayOrder).not.toHaveBeenCalled();
  });

  // 9. Razorpay amount exactly equals fresh ALLOW final_payable_minor
  it("9. passes exact fresh ALLOW final_payable_minor to Razorpay", async () => {
    const service = createService();
    await service.checkout(validCheckoutInput);

    expect(mockRazorpayAdapter.createRazorpayOrder).toHaveBeenCalledWith({
      amount_minor: 4500,
      currency: "INR",
      receipt: expect.stringMatching(/^rcpt_/),
    });
  });

  // 10. Payment/order are persisted as PAYMENT_PENDING via atomic persistence
  it("10. persists application order and payment atomically in PAYMENT_PENDING state", async () => {
    const service = createService();
    const result = await service.checkout(validCheckoutInput);

    expect(
      mockPaymentsRepo.createCheckoutPersistenceAtomic,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        final_payable_minor: 4500,
        payment_amount_minor: 4500,
        razorpay_order_id: "order_rzp_mock_999",
        idempotency_key: idempotencyKey,
      }),
    );

    expect(mockPaymentsRepo.createOrder).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createPayment).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createCheckoutIdempotency).not.toHaveBeenCalled();

    expect(result.status).toBe("PAYMENT_PENDING");
  });

  // 11. Same idempotency key + same fingerprint -> same logical result; no second provider order
  it("11. returns existing result on same idempotency key + same fingerprint without second provider order", async () => {
    const quoteVersion = "qv-2.0.0";
    const finalPayable = 4500;

    const savedFingerprint = buildCheckoutFingerprint({
      selection_id: selectionId,
      policy_decision_id: policyDecisionId,
      quote_version: quoteVersion,
      final_payable_minor: finalPayable,
    });

    const savedResult = {
      order_id: "order-previously-created",
      razorpay_order_id: "order_rzp_prior_111",
      amount_minor: finalPayable,
      currency: "INR",
      razorpay_key_id: "rzp_test_dummy",
      status: "PAYMENT_PENDING",
      policy_decision_id: policyDecisionId,
      quote_version: quoteVersion,
      request_id: "req-unit-1",
    };

    mockPaymentsRepo.findCheckoutIdempotency.mockResolvedValue({
      idempotency_id: "idem-rec-1",
      user_id: userId,
      idempotency_key: idempotencyKey,
      request_fingerprint: savedFingerprint,
      order_id: "order-previously-created",
      response_json: savedResult,
    });

    const service = createService();
    const result = await service.checkout(validCheckoutInput);

    expect(result).toEqual(savedResult);
    expect(mockRazorpayAdapter.createRazorpayOrder).not.toHaveBeenCalled();
    expect(mockBasketService.createFreshQuote).not.toHaveBeenCalled();
  });

  // 12. Same idempotency key + different fingerprint -> IDEMPOTENCY_CONFLICT; no provider order
  it("12. throws IDEMPOTENCY_CONFLICT on same idempotency key with different request fingerprint", async () => {
    const savedResult = {
      order_id: "order-previously-created",
      razorpay_order_id: "order_rzp_prior_111",
      amount_minor: 4500,
      currency: "INR",
      razorpay_key_id: "rzp_test_dummy",
      status: "PAYMENT_PENDING",
      policy_decision_id: policyDecisionId,
      quote_version: "qv-2.0.0",
      request_id: "req-unit-1",
    };

    mockPaymentsRepo.findCheckoutIdempotency.mockResolvedValue({
      idempotency_id: "idem-rec-1",
      user_id: userId,
      idempotency_key: idempotencyKey,
      request_fingerprint: "hash-of-a-different-selection-or-amount",
      order_id: "order-previously-created",
      response_json: savedResult,
    });

    const service = createService();

    try {
      await service.checkout(validCheckoutInput);
      expect.unreachable("Should have failed with IDEMPOTENCY_CONFLICT");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe(ErrorCodes.IDEMPOTENCY_CONFLICT);
      expect(appErr.statusCode).toBe(409);
    }

    expect(mockRazorpayAdapter.createRazorpayOrder).not.toHaveBeenCalled();
  });

  // 13. Provider timeout -> safe failure; no false payment success
  it("13. fails safely on provider timeout without converting to payment success", async () => {
    mockRazorpayAdapter.createRazorpayOrder.mockRejectedValue(
      new AppError({
        code: "PAYMENT_PROVIDER_TIMEOUT",
        message: "Payment provider request timed out",
        statusCode: 504,
      }),
    );

    const service = createService();

    try {
      await service.checkout(validCheckoutInput);
      expect.unreachable("Should have failed");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe("PAYMENT_PROVIDER_TIMEOUT");
      expect(appErr.statusCode).toBe(504);
    }

    expect(
      mockPaymentsRepo.createCheckoutPersistenceAtomic,
    ).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createOrder).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createPayment).not.toHaveBeenCalled();
  });

  // 14. Provider failure -> no false payment success
  it("14. fails on provider rejection without marking payment successful", async () => {
    mockRazorpayAdapter.createRazorpayOrder.mockRejectedValue(
      new AppError({
        code: "PAYMENT_PROVIDER_ERROR",
        message: "Payment provider rejected order creation",
        statusCode: 502,
      }),
    );

    const service = createService();

    try {
      await service.checkout(validCheckoutInput);
      expect.unreachable("Should have failed");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe("PAYMENT_PROVIDER_ERROR");
      expect(appErr.statusCode).toBe(502);
    }

    expect(
      mockPaymentsRepo.createCheckoutPersistenceAtomic,
    ).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createOrder).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createPayment).not.toHaveBeenCalled();
  });

  // 15. Provider order creation is never attempted before ALLOW
  it("15. never attempts provider order creation before policy ALLOW", async () => {
    const callOrder: string[] = [];

    mockBasketService.createFreshQuote.mockImplementation(async () => {
      callOrder.push("fresh_quote");
      return {
        quote_id: "q-1",
        quote_version: "v-1",
        final_payable_minor: 4500,
        gross_amount_minor: 5000,
        discount_amount_minor: 500,
      };
    });

    mockPolicyRevalidation.revalidate.mockImplementation(async () => {
      callOrder.push("policy_revalidate");
      return {
        decision: "ALLOW",
        reason_code: "AUTHORIZED",
        policy_decision_id: "pol-1",
        policy_version: "1.0",
        mandate_id: mandateId,
        basket_id: basketId,
        gross_amount_minor: 5000,
        discount_amount_minor: 500,
        final_payable_minor: 4500,
        max_spend_minor: 10000,
        evaluated_at: new Date().toISOString(),
        request_id: "req-1",
      };
    });

    mockRazorpayAdapter.createRazorpayOrder.mockImplementation(async () => {
      callOrder.push("razorpay_create");
      return {
        razorpay_order_id: "order_rzp_call_order",
        amount: 4500,
        currency: "INR",
        receipt: "rcpt_1",
        status: "created",
      };
    });

    const service = createService();
    await service.checkout(validCheckoutInput);

    expect(callOrder).toEqual([
      "fresh_quote",
      "policy_revalidate",
      "razorpay_create",
    ]);
  });

  // 16. PolicyRevalidationService is used rather than duplicated policy logic
  it("16. delegates to PolicyRevalidationService with authoritative correlation context", async () => {
    const service = createService();
    await service.checkout(validCheckoutInput);

    expect(mockPolicyRevalidation.revalidate).toHaveBeenCalledWith({
      user_id: userId,
      mandate_id: mandateId,
      basket_id: basketId,
      request_id: "req-unit-1",
      idempotency_key: "reval-idem-checkout-test-123-qv-2.0.0",
      quote_version: "qv-2.0.0",
    });
  });

  // 17. No client/AI path can produce VERIFIED
  it("17. ensures checkout produces PAYMENT_PENDING, never VERIFIED", async () => {
    const service = createService();
    const result = await service.checkout(validCheckoutInput);

    expect(result.status).toBe("PAYMENT_PENDING");
    expect(result.status).not.toBe("VERIFIED");
  });

  // 18. Phase 8 Step 4A: Performs ONE atomic persistence call (no separate INSERTs)
  it("18. performs ONE atomic persistence call (createCheckoutPersistenceAtomic) and no separate INSERTs", async () => {
    const service = createService();
    await service.checkout(validCheckoutInput);

    expect(
      mockPaymentsRepo.createCheckoutPersistenceAtomic,
    ).toHaveBeenCalledTimes(1);
    expect(mockPaymentsRepo.createOrder).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createPayment).not.toHaveBeenCalled();
    expect(mockPaymentsRepo.createCheckoutIdempotency).not.toHaveBeenCalled();
  });

  // 19. Phase 8 Step 4A: Throws PAYMENT_PERSISTENCE_FAILED when atomic persistence fails
  it("19. throws PAYMENT_PERSISTENCE_FAILED when atomic persistence fails after provider success", async () => {
    mockPaymentsRepo.createCheckoutPersistenceAtomic.mockRejectedValue(
      new AppError({
        code: "DATABASE_ERROR",
        message: "Database connection failed",
        statusCode: 500,
      }),
    );

    const service = createService();

    try {
      await service.checkout(validCheckoutInput);
      expect.unreachable("Should have failed");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe("PAYMENT_PERSISTENCE_FAILED");
      expect(appErr.statusCode).toBe(500);
      expect(appErr.details).toHaveProperty("razorpay_order_id", "order_rzp_mock_999");
    }
  });

  // 20. Phase 8 Step 4A: Rethrows IDEMPOTENCY_CONFLICT if atomic persistence detects conflict
  it("20. rethrows IDEMPOTENCY_CONFLICT if atomic persistence detects conflict", async () => {
    mockPaymentsRepo.createCheckoutPersistenceAtomic.mockRejectedValue(
      new AppError({
        code: ErrorCodes.IDEMPOTENCY_CONFLICT,
        message: "Idempotency conflict in atomic function",
        statusCode: 409,
      }),
    );

    const service = createService();

    try {
      await service.checkout(validCheckoutInput);
      expect.unreachable("Should have failed");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe(ErrorCodes.IDEMPOTENCY_CONFLICT);
      expect(appErr.statusCode).toBe(409);
    }
  });
});
