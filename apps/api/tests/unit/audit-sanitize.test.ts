import { describe, it, expect } from "vitest";
import { sanitizeAuditEventData } from "../../src/modules/audit/sanitize.js";

describe("sanitizeAuditEventData", () => {
  it("removes signatures and secret-like keys from audit payloads", () => {
    const sanitized = sanitizeAuditEventData({
      razorpay_order_id: "order_123",
      razorpay_payment_id: "pay_123",
      razorpay_signature: "must-not-persist",
      signature: "also-forbidden",
      RAZORPAY_KEY_SECRET: "secret_value",
      webhook_secret: "whsec_value",
      request_id: "req-safe-1",
      nested: {
        authorization: "Bearer secret",
        amount_minor: 5500,
      },
    });

    expect(sanitized).toEqual({
      razorpay_order_id: "order_123",
      razorpay_payment_id: "pay_123",
      request_id: "req-safe-1",
      nested: {
        amount_minor: 5500,
      },
    });
  });
});
