import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { RazorpayWebhookService } from "../../src/modules/webhooks/razorpay/service.js";
import type { WebhookProcessResult } from "../../src/modules/payments/types.js";
import { AppError } from "../../src/shared/errors/index.js";
import {
  AGENT_TOOL_NAMES,
  FORBIDDEN_AGENT_TOOL_NAMES,
} from "../../src/modules/agent/schema.js";

const RAZORPAY_WEBHOOK_SECRET = "whsec_route_test_webhook_secret";

function signWebhook(body: string): string {
  return createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
}

async function buildTestApp(): Promise<Express> {
  const { loadEnv } = await import("../../src/config/env.js");
  loadEnv({
    NODE_ENV: "test",
    JWT_SECRET: "test-jwt",
    RAZORPAY_KEY_ID: "rzp_test_public",
    RAZORPAY_KEY_SECRET: "rzp_test_secret",
    RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_ENV: "test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  });
  const { createApp } = await import("../../src/app.js");
  return createApp();
}

describe("POST /api/v1/webhooks/razorpay (Phase 8 Step 7)", () => {
  let app: Express;
  let webhookSpy: ReturnType<typeof vi.spyOn>;

  const successResult: WebhookProcessResult = {
    event_id: "evt_route_001",
    event_type: "payment.captured",
    outcome: "PROCESSED",
    payment_status: "VERIFIED",
    order_status: "PAYMENT_VERIFIED",
  };

  beforeEach(async () => {
    app = await buildTestApp();
    webhookSpy = vi
      .spyOn(RazorpayWebhookService.prototype, "processWebhook")
      .mockResolvedValue(successResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts webhook route and accepts signed payload", async () => {
    const body = JSON.stringify({
      id: "evt_route_001",
      event: "payment.captured",
      payload: {},
    });
    const res = await request(app)
      .post("/api/v1/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signWebhook(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe("PROCESSED");
    expect(webhookSpy).toHaveBeenCalled();
    expect(Buffer.isBuffer(webhookSpy.mock.calls[0]?.[0]?.rawBody)).toBe(true);
  });

  it("does not require JWT authentication", async () => {
    const body = JSON.stringify({ id: "evt_route_002", event: "payment.captured" });
    const res = await request(app)
      .post("/api/v1/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signWebhook(body))
      .send(body);
    expect(res.status).toBe(200);
  });

  it("propagates invalid signature errors from service", async () => {
    webhookSpy.mockRejectedValueOnce(
      new AppError({
        code: "WEBHOOK_SIGNATURE_INVALID",
        message: "Invalid webhook signature",
        statusCode: 401,
      }),
    );
    const body = JSON.stringify({ id: "evt_bad_sig", event: "payment.captured" });
    const res = await request(app)
      .post("/api/v1/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", "bad")
      .send(body);
    expect(res.status).toBe(401);
  });

  it("scope lock: no AI payment tools exist", () => {
    expect(AGENT_TOOL_NAMES).not.toContain("checkout");
    expect(AGENT_TOOL_NAMES).not.toContain("razorpay");
    expect(AGENT_TOOL_NAMES).not.toContain("verify_payment");
    expect(AGENT_TOOL_NAMES).not.toContain("create_razorpay_order");
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("checkout");
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("razorpay");
  });
});
