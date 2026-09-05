import { describe, it, expect } from "vitest";
import { buildCheckoutFingerprint } from "../../src/modules/payments/fingerprint.js";
import {
  createOrderInputSchema,
  createPaymentInputSchema,
  createCheckoutIdempotencyInputSchema,
  createRazorpayWebhookEventInputSchema,
} from "../../src/modules/payments/schema.js";

describe("Checkout Fingerprint Helper", () => {
  it("produces deterministic SHA-256 hex string", () => {
    const input = {
      selection_id: "11111111-1111-4111-8111-111111111111",
      policy_decision_id: "22222222-2222-4222-8222-222222222222",
      quote_version: "qv-1.0.0",
      final_payable_minor: 12500,
    };

    const fp1 = buildCheckoutFingerprint(input);
    const fp2 = buildCheckoutFingerprint({ ...input });
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different fingerprints for materially different inputs", () => {
    const base = {
      selection_id: "11111111-1111-4111-8111-111111111111",
      policy_decision_id: "22222222-2222-4222-8222-222222222222",
      quote_version: "qv-1.0.0",
      final_payable_minor: 12500,
    };

    const fpBase = buildCheckoutFingerprint(base);

    // Change amount
    expect(
      buildCheckoutFingerprint({ ...base, final_payable_minor: 12501 }),
    ).not.toBe(fpBase);

    // Change quote_version
    expect(
      buildCheckoutFingerprint({ ...base, quote_version: "qv-1.0.1" }),
    ).not.toBe(fpBase);

    // Change policy_decision_id
    expect(
      buildCheckoutFingerprint({
        ...base,
        policy_decision_id: "33333333-3333-4333-8333-333333333333",
      }),
    ).not.toBe(fpBase);

    // Change selection_id
    expect(
      buildCheckoutFingerprint({
        ...base,
        selection_id: "44444444-4444-4444-8444-444444444444",
      }),
    ).not.toBe(fpBase);
  });
});

describe("Payment Persistence Zod Schemas", () => {
  it("validates createOrderInputSchema", () => {
    const valid = {
      user_id: "11111111-1111-4111-8111-111111111111",
      session_id: "22222222-2222-4222-8222-222222222222",
      mandate_id: "33333333-3333-4333-8333-333333333333",
      basket_id: "44444444-4444-4444-8444-444444444444",
      policy_decision_id: "55555555-5555-4555-8555-555555555555",
      gross_amount_minor: 1000,
      discount_amount_minor: 200,
      final_payable_minor: 800,
    };

    expect(createOrderInputSchema.parse(valid)).toMatchObject({
      status: "CREATED",
      currency: "INR",
    });

    // Rejects discount exceeding gross
    expect(() =>
      createOrderInputSchema.parse({
        ...valid,
        discount_amount_minor: 1200,
      }),
    ).toThrow();
  });

  it("validates createPaymentInputSchema", () => {
    const valid = {
      order_id: "11111111-1111-4111-8111-111111111111",
      amount_minor: 800,
    };

    expect(createPaymentInputSchema.parse(valid)).toMatchObject({
      status: "PAYMENT_PENDING",
      currency: "INR",
    });

    // Rejects negative amount
    expect(() =>
      createPaymentInputSchema.parse({
        ...valid,
        amount_minor: -10,
      }),
    ).toThrow();
  });

  it("validates createCheckoutIdempotencyInputSchema", () => {
    const valid = {
      user_id: "11111111-1111-4111-8111-111111111111",
      idempotency_key: "idem-key-123",
      request_fingerprint: "a".repeat(64),
    };

    expect(createCheckoutIdempotencyInputSchema.parse(valid)).toBeDefined();

    // Rejects empty idempotency key
    expect(() =>
      createCheckoutIdempotencyInputSchema.parse({
        ...valid,
        idempotency_key: "   ",
      }),
    ).toThrow();
  });

  it("validates createRazorpayWebhookEventInputSchema", () => {
    const valid = {
      event_id: "evt_123456",
      event_type: "payment.captured",
    };

    expect(createRazorpayWebhookEventInputSchema.parse(valid)).toMatchObject({
      processing_status: "RECEIVED",
    });

    // Rejects empty event_id
    expect(() =>
      createRazorpayWebhookEventInputSchema.parse({
        ...valid,
        event_id: "  ",
      }),
    ).toThrow();
  });
});
