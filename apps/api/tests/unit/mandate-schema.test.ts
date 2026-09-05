import { describe, it, expect } from "vitest";
import {
  MANDATE_STATUSES,
  agentIdSchema,
  mandateCategorySchema,
  mandateCurrencySchema,
  mandateIdSchema,
  mandateSchema,
  mandateStatusSchema,
  moneyMinorSchema,
  userIdSchema,
} from "../../src/modules/mandate/schema.js";

/** Doc 10 Mandate A fixture (₹1000 = 100000 paise). */
const validMandateA = {
  mandate_id: "77777777-7777-4777-8777-777777777701",
  user_id: "44444444-4444-4444-8444-444444444401",
  agent_id: "agent-001",
  max_spend_minor: 100000,
  currency: "INR" as const,
  max_per_item_minor: 30000,
  purpose: "Mandate A — ₹1000 grocery ceiling",
  valid_until: "2026-12-31T23:59:59.000Z",
  status: "ACTIVE" as const,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

/** Doc 10 Mandate B fixture (₹800 = 80000 paise). */
const validMandateB = {
  ...validMandateA,
  mandate_id: "77777777-7777-4777-8777-777777777702",
  max_spend_minor: 80000,
  purpose: "Mandate B — ₹800 grocery ceiling",
};

/** Doc 10 Mandate C fixture (EXPIRED). */
const validMandateC = {
  ...validMandateA,
  mandate_id: "77777777-7777-4777-8777-777777777703",
  user_id: "44444444-4444-4444-8444-444444444402",
  agent_id: "agent-002",
  status: "EXPIRED" as const,
  valid_until: "2026-01-01T00:00:00.000Z",
  created_at: "2025-12-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  purpose: "Mandate C — expired fixture",
};

describe("mandate schema validation", () => {
  it("accepts Doc 10 Mandate A/B/C fixtures", () => {
    expect(mandateSchema.parse(validMandateA).max_spend_minor).toBe(100000);
    expect(mandateSchema.parse(validMandateB).max_spend_minor).toBe(80000);
    expect(mandateSchema.parse(validMandateC).status).toBe("EXPIRED");
  });

  it("validates mandate_id and user_id as UUIDs", () => {
    expect(mandateIdSchema.parse(validMandateA.mandate_id)).toBe(
      validMandateA.mandate_id,
    );
    expect(userIdSchema.parse(validMandateA.user_id)).toBe(
      validMandateA.user_id,
    );
    expect(() => mandateIdSchema.parse("mandate-001")).toThrow();
    expect(() =>
      mandateSchema.parse({ ...validMandateA, user_id: "user-1" }),
    ).toThrow();
  });

  it("requires nonempty agent_id", () => {
    expect(agentIdSchema.parse("agent-001")).toBe("agent-001");
    expect(() => agentIdSchema.parse("")).toThrow();
    expect(() => agentIdSchema.parse("   ")).toThrow();
  });

  it("requires max_spend_minor to be an integer >= 0", () => {
    expect(moneyMinorSchema.parse(0)).toBe(0);
    expect(moneyMinorSchema.parse(100000)).toBe(100000);
    expect(() => moneyMinorSchema.parse(-1)).toThrow();
    expect(() => moneyMinorSchema.parse(1000.5)).toThrow();
    expect(() =>
      mandateSchema.parse({ ...validMandateA, max_spend_minor: -1 }),
    ).toThrow();
    expect(() =>
      mandateSchema.parse({ ...validMandateA, max_spend_minor: 12.5 }),
    ).toThrow();
  });

  it("requires max_per_item_minor >= 0 when present", () => {
    expect(
      mandateSchema.parse({ ...validMandateA, max_per_item_minor: null })
        .max_per_item_minor,
    ).toBeNull();
    expect(() =>
      mandateSchema.parse({ ...validMandateA, max_per_item_minor: -1 }),
    ).toThrow();
    expect(() =>
      mandateSchema.parse({ ...validMandateA, max_per_item_minor: 300.5 }),
    ).toThrow();
  });

  it("requires currency INR", () => {
    expect(mandateCurrencySchema.parse("INR")).toBe("INR");
    expect(() => mandateCurrencySchema.parse("USD")).toThrow();
    expect(() =>
      mandateSchema.parse({
        ...validMandateA,
        currency: "USD",
      }),
    ).toThrow();
  });

  it("accepts controlled mandate lifecycle statuses only", () => {
    for (const status of MANDATE_STATUSES) {
      const row =
        status === "ACTIVE"
          ? { ...validMandateA, status }
          : { ...validMandateC, status };
      expect(mandateStatusSchema.parse(status)).toBe(status);
      expect(mandateSchema.parse(row).status).toBe(status);
    }
  });

  it("rejects unsupported mandate statuses", () => {
    expect(() => mandateStatusSchema.parse("INACTIVE")).toThrow();
    expect(() => mandateStatusSchema.parse("PAYMENT_PENDING")).toThrow();
    expect(() =>
      mandateSchema.parse({ ...validMandateA, status: "CONSUMED" }),
    ).toThrow();
  });

  it("requires ACTIVE valid_until later than created_at", () => {
    expect(() =>
      mandateSchema.parse({
        ...validMandateA,
        status: "ACTIVE",
        created_at: "2026-09-01T00:00:00.000Z",
        valid_until: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow(/valid_until/);
    expect(() =>
      mandateSchema.parse({
        ...validMandateA,
        status: "ACTIVE",
        created_at: "2026-09-01T00:00:00.000Z",
        valid_until: "2026-08-31T23:59:59.000Z",
      }),
    ).toThrow(/valid_until/);
  });

  it("allows non-ACTIVE mandates without future valid_until", () => {
    expect(
      mandateSchema.parse({
        ...validMandateC,
        status: "EXPIRED",
        valid_until: "2026-01-01T00:00:00.000Z",
        created_at: "2025-12-01T00:00:00.000Z",
      }).status,
    ).toBe("EXPIRED");
  });

  it("accepts normalized mandate_category rows", () => {
    expect(
      mandateCategorySchema.parse({
        mandate_id: validMandateA.mandate_id,
        category: "grocery",
      }).category,
    ).toBe("grocery");
  });

  it("rejects empty mandate category labels", () => {
    expect(() =>
      mandateCategorySchema.parse({
        mandate_id: validMandateA.mandate_id,
        category: "",
      }),
    ).toThrow();
    expect(() =>
      mandateCategorySchema.parse({
        mandate_id: validMandateA.mandate_id,
        category: "   ",
      }),
    ).toThrow();
  });

  it("does not define policy decision or payment fields", () => {
    const parsed = mandateSchema.parse(validMandateA);
    expect(parsed).not.toHaveProperty("policy_decision_id");
    expect(parsed).not.toHaveProperty("allowed_categories");
    expect(parsed).not.toHaveProperty("razorpay_order_id");
    expect(parsed).not.toHaveProperty("final_payable_minor");
  });
});
