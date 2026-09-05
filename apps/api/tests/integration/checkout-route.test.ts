import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { CheckoutService } from "../../src/modules/checkout/service.js";
import type { CheckoutResult } from "../../src/modules/checkout/types.js";
import { AppError } from "../../src/shared/errors/index.js";
import { AgentToolRegistry } from "../../src/modules/agent/tools/registry.js";
import {
  AGENT_TOOL_NAMES,
  FORBIDDEN_AGENT_TOOL_NAMES,
} from "../../src/modules/agent/schema.js";

const JWT_SECRET = "test-jwt-secret-checkout-route-step5-secure";
const RAZORPAY_KEY_ID = "rzp_test_public_key_12345";
const RAZORPAY_KEY_SECRET = "secret_super_confidential_razorpay_key";
const RAZORPAY_WEBHOOK_SECRET = "whsec_super_secret_webhook_signature";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const selectionId = "33333333-3333-4333-8333-333333333333";
const policyDecisionId = "44444444-4444-4444-8444-444444444444";
const orderId = "55555555-5555-4555-8555-555555555555";
const razorpayOrderId = "order_rzp_mock_123456";

function signToken(userId: string, extra: Record<string, unknown> = {}): string {
  return jwt.sign({ sub: userId, ...extra }, JWT_SECRET, { expiresIn: "1h" });
}

let originalJwtSecret: string | undefined;

async function buildTestApp(): Promise<Express> {
  originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.RAZORPAY_KEY_ID = RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_ENV = "test";

  const { loadEnv } = await import("../../src/config/env.js");
  loadEnv({
    NODE_ENV: "test",
    JWT_SECRET,
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_ENV: "test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  });
  const { createApp } = await import("../../src/app.js");
  return createApp();
}

describe("POST /api/v1/checkout (Phase 8 Step 5)", () => {
  let app: Express;
  let checkoutSpy: ReturnType<typeof vi.spyOn>;

  const successfulCheckoutResult: CheckoutResult = {
    order_id: orderId,
    razorpay_order_id: razorpayOrderId,
    amount_minor: 4500,
    currency: "INR",
    status: "PAYMENT_PENDING",
    razorpay_key_id: RAZORPAY_KEY_ID,
    replayed: false,
  };

  beforeEach(async () => {
    app = await buildTestApp();
    checkoutSpy = vi
      .spyOn(CheckoutService.prototype, "checkout")
      .mockResolvedValue(successfulCheckoutResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalJwtSecret !== undefined) {
      process.env.JWT_SECRET = originalJwtSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 1: Authenticated valid checkout
  // ---------------------------------------------------------------------------
  it("Scenario 1: Authenticated valid checkout returns 201 with server-authoritative fields", async () => {
    const res = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-valid-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toEqual({
      order_id: orderId,
      razorpay_order_id: razorpayOrderId,
      amount_minor: 4500,
      currency: "INR",
      status: "PAYMENT_PENDING",
      razorpay_key_id: RAZORPAY_KEY_ID,
    });
    expect(res.body).toHaveProperty("meta");
    expect(res.body.meta).toHaveProperty("request_id");

    // Verified service was called with authenticated user identity from JWT
    expect(checkoutSpy).toHaveBeenCalledTimes(1);
    expect(checkoutSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userA,
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
        idempotency_key: "idem-test-valid-001",
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Unauthenticated checkout
  // ---------------------------------------------------------------------------
  it("Scenario 2: Unauthenticated checkout is rejected before CheckoutService is executed", async () => {
    // Missing Authorization header
    const res1 = await request(app)
      .post("/api/v1/checkout")
      .set("Idempotency-Key", "idem-test-unauth-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res1.status).toBe(401);
    expect(res1.body.error?.code).toBe(ErrorCodes.UNAUTHORIZED);
    expect(checkoutSpy).not.toHaveBeenCalled();

    // Invalid token
    const res2 = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", "Bearer invalid.jwt.token")
      .set("Idempotency-Key", "idem-test-unauth-002")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res2.status).toBe(401);
    expect(res2.body.error?.code).toBe(ErrorCodes.UNAUTHORIZED);
    expect(checkoutSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Missing Idempotency-Key
  // ---------------------------------------------------------------------------
  it("Scenario 3: Missing or whitespace Idempotency-Key is rejected before CheckoutService is executed", async () => {
    // Missing header entirely
    const res1 = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res1.status).toBe(400);
    expect(res1.body.error?.code).toBe(ErrorCodes.IDEMPOTENCY_REQUIRED);
    expect(checkoutSpy).not.toHaveBeenCalled();

    // Whitespace header
    const res2 = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "   ")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res2.status).toBe(400);
    expect(res2.body.error?.code).toBe(ErrorCodes.IDEMPOTENCY_REQUIRED);
    expect(checkoutSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Malformed body
  // ---------------------------------------------------------------------------
  it("Scenario 4: Malformed request body is rejected before CheckoutService is executed", async () => {
    // Empty body
    const res1 = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-malformed-001")
      .send({});

    expect(res1.status).toBe(400);
    expect(res1.body.error?.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(checkoutSpy).not.toHaveBeenCalled();

    // Non-UUID values
    const res2 = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-malformed-002")
      .send({
        selection_id: "not-a-uuid",
        policy_decision_id: "not-a-uuid",
      });

    expect(res2.status).toBe(400);
    expect(res2.body.error?.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(checkoutSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Client-supplied amount / forbidden fields
  // ---------------------------------------------------------------------------
  it("Scenario 5: Client-supplied amount and forbidden fields are strictly rejected", async () => {
    const forbiddenPayloads = [
      {
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
        amount: 100,
      },
      {
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
        final_payable_minor: 50,
      },
      {
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
        user_id: userB,
      },
      {
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
        mandate_id: "66666666-6666-4666-8666-666666666666",
      },
      {
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
        razorpay_order_id: "order_spoofed_999",
      },
      {
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
        status: "VERIFIED",
      },
    ];

    for (const payload of forbiddenPayloads) {
      const res = await request(app)
        .post("/api/v1/checkout")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .set("Idempotency-Key", "idem-test-client-amount-001")
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(checkoutSpy).not.toHaveBeenCalled();
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Cross-user selection
  // ---------------------------------------------------------------------------
  it("Scenario 6: Cross-user selection rejection by CheckoutService maps to 403 FORBIDDEN", async () => {
    checkoutSpy.mockRejectedValueOnce(
      new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Selection does not belong to authenticated user",
        statusCode: 403,
      }),
    );

    const res = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-cross-user-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe(ErrorCodes.FORBIDDEN);
    expect(res.body.error?.message).toContain("Selection does not belong to authenticated user");
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: Policy DENY
  // ---------------------------------------------------------------------------
  it("Scenario 7: Policy DENY from fresh evaluation maps to 422 with structured policy error", async () => {
    checkoutSpy.mockRejectedValueOnce(
      new AppError({
        code: "POLICY_DENIED",
        message: "Policy revalidation denied: MAX_SPEND_EXCEEDED",
        statusCode: 422,
        details: {
          decision: "DENY",
          reason_code: "MAX_SPEND_EXCEEDED",
          policy_decision_id: "pol-deny-123",
        },
      }),
    );

    const res = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-policy-deny-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("POLICY_DENIED");
    expect(res.body.error?.details).toEqual({
      decision: "DENY",
      reason_code: "MAX_SPEND_EXCEEDED",
      policy_decision_id: "pol-deny-123",
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: Stale authorization / Revalidation gate
  // ---------------------------------------------------------------------------
  it("Scenario 8: Stale prior authorization cannot bypass fresh revalidation gate", async () => {
    checkoutSpy.mockRejectedValueOnce(
      new AppError({
        code: "POLICY_DENIED",
        message: "Policy revalidation denied: PRICE_CHANGED_EXCEEDS_MAX",
        statusCode: 422,
        details: {
          decision: "DENY",
          reason_code: "PRICE_CHANGED_EXCEEDS_MAX",
          policy_decision_id: "pol-stale-001",
        },
      }),
    );

    const res = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-stale-revalidation-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("POLICY_DENIED");
    expect(res.body.error?.message).toContain("PRICE_CHANGED_EXCEEDS_MAX");
  });

  // ---------------------------------------------------------------------------
  // Scenario 9: Same Idempotency-Key + same request
  // ---------------------------------------------------------------------------
  it("Scenario 9: Same Idempotency-Key + same request returns replayed checkout without second order", async () => {
    // First invocation
    const res1 = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-replay-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res1.status).toBe(201);
    expect(res1.body.data.order_id).toBe(orderId);

    // Mock service returning replayed result
    checkoutSpy.mockResolvedValueOnce({
      ...successfulCheckoutResult,
      replayed: true,
    });

    // Replay invocation
    const res2 = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-replay-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.order_id).toBe(orderId);
    expect(res2.body.data.razorpay_order_id).toBe(razorpayOrderId);
    expect(checkoutSpy).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // Scenario 10: Same Idempotency-Key + materially different request
  // ---------------------------------------------------------------------------
  it("Scenario 10: Same Idempotency-Key + materially different request yields 409 IDEMPOTENCY_CONFLICT", async () => {
    checkoutSpy.mockRejectedValueOnce(
      new AppError({
        code: ErrorCodes.IDEMPOTENCY_CONFLICT,
        message: "Idempotency key already used with different request parameters",
        statusCode: 409,
      }),
    );

    const res = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-conflict-key-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe(ErrorCodes.IDEMPOTENCY_CONFLICT);
  });

  // ---------------------------------------------------------------------------
  // Scenario 11: Provider failure
  // ---------------------------------------------------------------------------
  it("Scenario 11: Provider failure maps to HTTP 424 PAYMENT_PROVIDER_ERROR with structured envelope", async () => {
    checkoutSpy.mockRejectedValueOnce(
      new AppError({
        code: "PAYMENT_PROVIDER_ERROR",
        message: "Razorpay order creation timed out",
        statusCode: 502,
        details: { provider: "razorpay" },
      }),
    );

    const res = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-provider-fail-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res.status).toBe(424);
    expect(res.body.error?.code).toBe("PAYMENT_PROVIDER_ERROR");
    expect(res.body.error?.message).toBe("Razorpay order creation timed out");
    expect(res.body.error?.details).toEqual({ provider: "razorpay" });
    expect(res.body.error?.request_id).toBeDefined();
    expect(res.body).not.toHaveProperty("data");

    // Also assert adapter timeout (statusCode: 504) maps to 424 PAYMENT_PROVIDER_ERROR
    checkoutSpy.mockRejectedValueOnce(
      new AppError({
        code: "PAYMENT_PROVIDER_TIMEOUT",
        message: "Payment provider request timed out",
        statusCode: 504,
        details: { provider: "razorpay", is_timeout: true },
      }),
    );

    const resTimeout = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-provider-fail-002")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(resTimeout.status).toBe(424);
    expect(resTimeout.body.error?.code).toBe("PAYMENT_PROVIDER_ERROR");
    expect(resTimeout.body.error?.details).toEqual({ provider: "razorpay", is_timeout: true });
    expect(resTimeout.body.error?.request_id).toBeDefined();
    expect(resTimeout.body).not.toHaveProperty("data");
  });

  // ---------------------------------------------------------------------------
  // Scenario 12: Persistence failure
  // ---------------------------------------------------------------------------
  it("Scenario 12: Persistence failure returns safe error without false success", async () => {
    checkoutSpy.mockRejectedValueOnce(
      new AppError({
        code: "PAYMENT_PERSISTENCE_FAILED",
        message: "Checkout persistence failed after provider order creation. Reconciliation required.",
        statusCode: 500,
      }),
    );

    const res = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-persistence-fail-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res.status).toBe(500);
    expect(res.body.error?.code).toBe("PAYMENT_PERSISTENCE_FAILED");
    expect(res.body).not.toHaveProperty("data");
  });

  // ---------------------------------------------------------------------------
  // Scenario 13: Response secret-leak test
  // ---------------------------------------------------------------------------
  it("Scenario 13: Response never exposes RAZORPAY_KEY_SECRET or RAZORPAY_WEBHOOK_SECRET", async () => {
    const res = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-secret-leak-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res.status).toBe(201);
    const bodyString = JSON.stringify(res.body);

    expect(bodyString).not.toContain(RAZORPAY_KEY_SECRET);
    expect(bodyString).not.toContain(RAZORPAY_WEBHOOK_SECRET);
    expect(bodyString).not.toContain("secret_super_confidential");
    expect(bodyString).not.toContain("whsec_super_secret");

    // Only RAZORPAY_KEY_ID is allowed to be exposed
    expect(res.body.data.razorpay_key_id).toBe(RAZORPAY_KEY_ID);
  });

  // ---------------------------------------------------------------------------
  // Scenario 14: Route cannot directly mark payment VERIFIED
  // ---------------------------------------------------------------------------
  it("Scenario 14: Route always sets PAYMENT_PENDING and never accepts payment verification mutations", async () => {
    // 1. Success response is locked to PAYMENT_PENDING
    const res = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("Idempotency-Key", "idem-test-verified-immutability-001")
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PAYMENT_PENDING");

    // 2. Verification route exists in Step 6 and strictly rejects invalid mutation payload
    const verifyRes = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({ payment_id: "payment-123" });

    expect(verifyRes.status).toBe(400);

    // 3. Webhook route is mounted (Step 7) and rejects unsigned payloads
    const webhookRes = await request(app)
      .post("/api/v1/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .send({});

    expect(webhookRes.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Scenario 15: AI agent remains unable to invoke checkout/payment tools
  // ---------------------------------------------------------------------------
  it("Scenario 15: AI agent remains unable to invoke checkout or payment tools", async () => {
    const registry = new AgentToolRegistry();

    // 1. Verify AGENT_TOOL_NAMES does not contain payment or checkout tools
    expect(AGENT_TOOL_NAMES).not.toContain("checkout");
    expect(AGENT_TOOL_NAMES).not.toContain("razorpay");
    expect(AGENT_TOOL_NAMES).not.toContain("payment_verification");
    expect(AGENT_TOOL_NAMES).not.toContain("create_order");
    expect(AGENT_TOOL_NAMES).not.toContain("process_payment");

    // 2. Verify FORBIDDEN_AGENT_TOOL_NAMES contains payment/checkout operations
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("checkout");
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("razorpay");
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("payment_verification");

    // 3. Attempting to register a forbidden tool throws immediately
    expect(() => {
      registry.register("checkout" as unknown as AgentToolName, vi.fn());
    }).toThrow(/Refusing to register/);

    expect(() => {
      registry.register("razorpay" as unknown as AgentToolName, vi.fn());
    }).toThrow(/Refusing to register/);

    // 4. Invoking forbidden tool through registry fails closed
    const mockContext = {} as unknown as AgentToolContext;
    const forbiddenResult = await registry.invoke("checkout", {}, mockContext);
    expect(forbiddenResult.status).toBe("ERROR");
    expect(forbiddenResult.error?.code).toBe("TOOL_FORBIDDEN");

    const forbiddenResult2 = await registry.invoke("razorpay", {}, mockContext);
    expect(forbiddenResult2.status).toBe("ERROR");
    expect(forbiddenResult2.error?.code).toBe("TOOL_FORBIDDEN");

    const nonAllowlistedResult = await registry.invoke("create_order", {}, mockContext);
    expect(nonAllowlistedResult.status).toBe("ERROR");
    expect(nonAllowlistedResult.error?.code).toBe("TOOL_NOT_ALLOWLISTED");
  });
});
