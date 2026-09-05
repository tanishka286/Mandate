import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { PaymentsService } from "../../src/modules/payments/service.js";
import type { VerifyPaymentResult } from "../../src/modules/payments/types.js";
import { AppError } from "../../src/shared/errors/index.js";
import { AgentToolRegistry } from "../../src/modules/agent/tools/registry.js";
import {
  AGENT_TOOL_NAMES,
  FORBIDDEN_AGENT_TOOL_NAMES,
} from "../../src/modules/agent/schema.js";

const JWT_SECRET = "test-jwt-secret-payment-verify-step6-secure";
const RAZORPAY_KEY_ID = "rzp_test_public_key_67890";
const RAZORPAY_KEY_SECRET = "secret_super_confidential_razorpay_key_step6";
const RAZORPAY_WEBHOOK_SECRET = "whsec_super_secret_webhook_signature_step6";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const paymentId = "44444444-4444-4444-8444-444444444444";
const razorpayOrderId = "order_rzp_mock_123456";
const razorpayPaymentId = "pay_rzp_mock_654321";
const razorpaySignature = "f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8";

function signToken(sub: string, extra: Record<string, unknown> = {}): string {
  return jwt.sign({ sub, ...extra }, JWT_SECRET, { expiresIn: "1h" });
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

describe("POST /api/v1/payments/verify (Phase 8 Step 6)", () => {
  let app: Express;
  let verifySpy: ReturnType<typeof vi.spyOn>;

  const successfulVerifyResult: VerifyPaymentResult = {
    payment_id: paymentId,
    order_id: orderId,
    status: "VERIFIED",
    razorpay_payment_id: razorpayPaymentId,
    amount_minor: 7500,
    verified_at: "2026-09-05T12:00:00.000Z",
  };

  beforeEach(async () => {
    app = await buildTestApp();
    verifySpy = vi
      .spyOn(PaymentsService.prototype, "verifyPayment")
      .mockResolvedValue(successfulVerifyResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalJwtSecret !== undefined) {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 1: Valid Verification (200 OK + Locked Envelope)
  // ---------------------------------------------------------------------------
  it("Scenario 1: Authenticated valid verification returns HTTP 200 with locked response shape", async () => {
    const res = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toEqual({
      payment_id: paymentId,
      order_id: orderId,
      status: "VERIFIED",
      razorpay_payment_id: razorpayPaymentId,
      amount_minor: 7500,
      verified_at: "2026-09-05T12:00:00.000Z",
    });
    expect(res.body.meta).toHaveProperty("request_id");

    // Assert service called with trusted user id from JWT
    expect(verifySpy).toHaveBeenCalledWith({
      user_id: userId,
      order_id: orderId,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Unauthenticated Request Rejected (401 UNAUTHORIZED)
  // ---------------------------------------------------------------------------
  it("Scenario 2: Unauthenticated request is rejected with 401 before PaymentsService is invoked", async () => {
    const resNoToken = await request(app)
      .post("/api/v1/payments/verify")
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });

    expect(resNoToken.status).toBe(401);
    expect(resNoToken.body.error?.code).toBe(ErrorCodes.UNAUTHORIZED);

    const resInvalidToken = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", "Bearer invalid.jwt.token")
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });

    expect(resInvalidToken.status).toBe(401);
    expect(resInvalidToken.body.error?.code).toBe(ErrorCodes.UNAUTHORIZED);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Malformed Request Rejected (400 VALIDATION_ERROR)
  // ---------------------------------------------------------------------------
  it("Scenario 3: Malformed request body is rejected before PaymentsService is executed", async () => {
    // 1. Non-UUID order_id
    const resBadUuid = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: "not-a-uuid",
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });
    expect(resBadUuid.status).toBe(400);
    expect(resBadUuid.body.error?.code).toBe(ErrorCodes.VALIDATION_ERROR);

    // 2. Empty razorpay_order_id
    const resEmptyRzpOrder = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: "   ",
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });
    expect(resEmptyRzpOrder.status).toBe(400);

    // 3. Empty razorpay_payment_id
    const resEmptyPaymentId = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: "",
        razorpay_signature: razorpaySignature,
      });
    expect(resEmptyPaymentId.status).toBe(400);

    // 4. Missing signature
    const resMissingSig = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
      });
    expect(resMissingSig.status).toBe(400);

    expect(verifySpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Client-Supplied Forbidden / State Fields Rejected (Strict Schema)
  // ---------------------------------------------------------------------------
  it("Scenario 4: Strict schema rejects client-supplied status, amount, user_id, or internal payment_id", async () => {
    const forbiddenPayloads = [
      { status: "VERIFIED" },
      { amount: 100 },
      { amount_minor: 100 },
      { currency: "INR" },
      { user_id: otherUserId },
      { payment_id: paymentId },
      { verified_at: new Date().toISOString() },
      { success: true },
      { state: "VERIFIED" },
    ];

    for (const forbidden of forbiddenPayloads) {
      const res = await request(app)
        .post("/api/v1/payments/verify")
        .set("Authorization", `Bearer ${signToken(userId)}`)
        .send({
          order_id: orderId,
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: razorpaySignature,
          ...forbidden,
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }

    expect(verifySpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Cross-User Rejection Maps to 403 FORBIDDEN
  // ---------------------------------------------------------------------------
  it("Scenario 5: Cross-user verification rejection maps to 403 FORBIDDEN", async () => {
    verifySpy.mockRejectedValueOnce(
      new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Order does not belong to authenticated user",
        statusCode: 403,
      }),
    );

    const res = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(otherUserId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe(ErrorCodes.FORBIDDEN);
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Amount Mismatch Maps to 422 PAYMENT_AMOUNT_MISMATCH
  // ---------------------------------------------------------------------------
  it("Scenario 6: Amount mismatch maps to 422 PAYMENT_AMOUNT_MISMATCH", async () => {
    verifySpy.mockRejectedValueOnce(
      new AppError({
        code: "PAYMENT_AMOUNT_MISMATCH",
        message: "Observed provider payment amount does not match authorized order amount",
        statusCode: 422,
        details: { observed_amount_minor: 4000, expected_order_amount_minor: 7500 },
      }),
    );

    const res = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("PAYMENT_AMOUNT_MISMATCH");
    expect(res.body.data).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: Provider Failure Maps to 424 PAYMENT_PROVIDER_ERROR (Doc 08 §24)
  // ---------------------------------------------------------------------------
  it("Scenario 7: Provider failure maps to HTTP 424 PAYMENT_PROVIDER_ERROR", async () => {
    verifySpy.mockRejectedValueOnce(
      new AppError({
        code: "PAYMENT_PROVIDER_ERROR",
        message: "Payment provider rejected lookup",
        statusCode: 502,
      }),
    );

    const res = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });

    expect(res.status).toBe(424);
    expect(res.body.error?.code).toBe("PAYMENT_PROVIDER_ERROR");
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: Provider Timeout Maps to HTTP 424 PAYMENT_PROVIDER_ERROR
  // ---------------------------------------------------------------------------
  it("Scenario 8: Provider timeout maps to HTTP 424 PAYMENT_PROVIDER_ERROR", async () => {
    verifySpy.mockRejectedValueOnce(
      new AppError({
        code: "PAYMENT_PROVIDER_TIMEOUT",
        message: "Payment provider request timed out",
        statusCode: 504,
      }),
    );

    const res = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });

    expect(res.status).toBe(424);
    expect(res.body.error?.code).toBe("PAYMENT_PROVIDER_ERROR");
  });

  // ---------------------------------------------------------------------------
  // Scenario 9: Already VERIFIED + Conflicting Identifiers Maps to 409 CONFLICT
  // ---------------------------------------------------------------------------
  it("Scenario 9: Already VERIFIED with conflicting identifiers maps to 409 CONFLICT", async () => {
    verifySpy.mockRejectedValueOnce(
      new AppError({
        code: ErrorCodes.CONFLICT,
        message: "Payment is already verified with different provider identifiers",
        statusCode: 409,
      }),
    );

    const res = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: "pay_rzp_conflicting_999",
        razorpay_signature: razorpaySignature,
      });

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe(ErrorCodes.CONFLICT);
  });

  // ---------------------------------------------------------------------------
  // Scenario 10: Secret Leak Prevention
  // ---------------------------------------------------------------------------
  it("Scenario 10: Secret leak prevention: response never exposes secrets or payment signature", async () => {
    const res = await request(app)
      .post("/api/v1/payments/verify")
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .send({
        order_id: orderId,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      });

    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);

    expect(bodyStr).not.toContain(RAZORPAY_KEY_SECRET);
    expect(bodyStr).not.toContain(RAZORPAY_WEBHOOK_SECRET);
    expect(bodyStr).not.toContain(razorpaySignature);
  });

  // ---------------------------------------------------------------------------
  // Scenario 11: AI Agent Remains Forbidden from Payment Verification Tools
  // ---------------------------------------------------------------------------
  it("Scenario 11: AI agent remains forbidden from invoking payment verification tools", async () => {
    const registry = new AgentToolRegistry();

    expect(AGENT_TOOL_NAMES).not.toContain("payment_verification");
    expect(AGENT_TOOL_NAMES).not.toContain("verify_payment");
    expect(AGENT_TOOL_NAMES).not.toContain("checkout");

    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("payment_verification");
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("checkout");
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("razorpay");

    expect(registry.has("payment_verification")).toBe(false);
    expect(registry.has("checkout")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Scenario 12: Scope Lock Holds (No Webhook Route)
  // ---------------------------------------------------------------------------
  it("Scenario 12: Scope lock holds: webhook route /api/v1/webhooks/razorpay is not mounted", async () => {
    const webhookRes = await request(app)
      .post("/api/v1/webhooks/razorpay")
      .send({});

    expect(webhookRes.status).toBe(404);
  });
});
