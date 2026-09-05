import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RazorpayServerAdapter } from "../../src/modules/payments/razorpay-adapter.js";

const WEBHOOK_SECRET = "whsec_test_webhook_secret_value";

function signWebhook(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("RazorpayServerAdapter.verifyWebhookSignature (Phase 8 Step 7)", () => {
  let adapter: RazorpayServerAdapter;

  beforeEach(() => {
    adapter = new RazorpayServerAdapter({
      client: { orders: { create: vi.fn() } },
      keySecret: "key_secret",
      webhookSecret: WEBHOOK_SECRET,
      env: "test",
    });
  });

  it("accepts a valid webhook signature", () => {
    const body = JSON.stringify({ event: "payment.captured", id: "evt_1" });
    const signature = signWebhook(body, WEBHOOK_SECRET);
    expect(adapter.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it("rejects an invalid webhook signature", () => {
    const body = JSON.stringify({ event: "payment.captured", id: "evt_1" });
    expect(adapter.verifyWebhookSignature(body, "deadbeef")).toBe(false);
  });

  it("rejects missing signature input", () => {
    const body = JSON.stringify({ event: "payment.captured", id: "evt_1" });
    expect(adapter.verifyWebhookSignature(body, "")).toBe(false);
  });

  it("rejects empty body", () => {
    const signature = signWebhook("{}", WEBHOOK_SECRET);
    expect(adapter.verifyWebhookSignature("", signature)).toBe(false);
  });

  it("uses constant-time comparison semantics for mismatched lengths", () => {
    const body = JSON.stringify({ event: "payment.captured", id: "evt_1" });
    expect(adapter.verifyWebhookSignature(body, "short")).toBe(false);
  });
});
