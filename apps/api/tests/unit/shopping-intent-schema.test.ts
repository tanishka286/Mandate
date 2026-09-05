import { describe, it, expect } from "vitest";
import {
  SHOPPING_INTENT_STATUSES,
  assumptionsJsonSchema,
  budgetMinorSchema,
  goalTextSchema,
  intentCategorySchema,
  intentIdSchema,
  mandateIdSchema,
  qualityPreferenceSchema,
  sessionIdSchema,
  shoppingIntentSchema,
  shoppingIntentStatusSchema,
} from "../../src/modules/intents/schema.js";

/** Doc 08 pasta intent fixture (₹1000 = 100000 paise). */
const validIntent = {
  intent_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
  session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
  mandate_id: "77777777-7777-4777-8777-777777777701",
  goal_text: "Pasta for 4, budget ₹1000",
  category: "grocery",
  budget_minor: 100000,
  quality_preference: null as string | null,
  status: "CREATED" as const,
  assumptions_json: [] as unknown[],
  created_at: "2026-09-05T06:10:00.000Z",
  updated_at: "2026-09-05T06:10:00.000Z",
};

describe("shopping intent schema validation", () => {
  it("accepts a valid shopping intent fixture", () => {
    const parsed = shoppingIntentSchema.parse(validIntent);
    expect(parsed.intent_id).toBe(validIntent.intent_id);
    expect(parsed.status).toBe("CREATED");
    expect(parsed.budget_minor).toBe(100000);
  });

  it("validates intent_id, session_id, and mandate_id as UUIDs", () => {
    expect(intentIdSchema.parse(validIntent.intent_id)).toBe(
      validIntent.intent_id,
    );
    expect(sessionIdSchema.parse(validIntent.session_id)).toBe(
      validIntent.session_id,
    );
    expect(mandateIdSchema.parse(validIntent.mandate_id)).toBe(
      validIntent.mandate_id,
    );
  });

  it("rejects malformed UUIDs", () => {
    expect(() => intentIdSchema.parse("intent-001")).toThrow();
    expect(() => sessionIdSchema.parse("session-001")).toThrow();
    expect(() => mandateIdSchema.parse("mandate-001")).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        intent_id: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        session_id: "session-1",
      }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        mandate_id: "mandate-1",
      }),
    ).toThrow();
  });

  it("requires nonempty goal_text", () => {
    expect(goalTextSchema.parse(validIntent.goal_text)).toBe(
      validIntent.goal_text,
    );
    expect(() => goalTextSchema.parse("")).toThrow();
    expect(() => goalTextSchema.parse("   ")).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({ ...validIntent, goal_text: "" }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({ ...validIntent, goal_text: "   " }),
    ).toThrow();
  });

  it("requires nonempty category", () => {
    expect(intentCategorySchema.parse("grocery")).toBe("grocery");
    expect(() => intentCategorySchema.parse("")).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({ ...validIntent, category: "   " }),
    ).toThrow();
  });

  it("allows nullable budget_minor", () => {
    expect(
      shoppingIntentSchema.parse({ ...validIntent, budget_minor: null })
        .budget_minor,
    ).toBeNull();
  });

  it("accepts integer minor-unit budget_minor", () => {
    expect(budgetMinorSchema.parse(0)).toBe(0);
    expect(budgetMinorSchema.parse(100000)).toBe(100000);
    expect(
      shoppingIntentSchema.parse({ ...validIntent, budget_minor: 100000 })
        .budget_minor,
    ).toBe(100000);
  });

  it("rejects negative budget_minor", () => {
    expect(() => budgetMinorSchema.parse(-1)).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({ ...validIntent, budget_minor: -1 }),
    ).toThrow();
  });

  it("rejects floating-point budget_minor", () => {
    expect(() => budgetMinorSchema.parse(1000.5)).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({ ...validIntent, budget_minor: 12.5 }),
    ).toThrow();
  });

  it("allows nullable quality_preference", () => {
    expect(qualityPreferenceSchema.parse(null)).toBeNull();
    expect(
      shoppingIntentSchema.parse({
        ...validIntent,
        quality_preference: null,
      }).quality_preference,
    ).toBeNull();
    expect(
      shoppingIntentSchema.parse({
        ...validIntent,
        quality_preference: "premium",
      }).quality_preference,
    ).toBe("premium");
  });

  it("rejects empty quality_preference when provided", () => {
    expect(() => qualityPreferenceSchema.parse("")).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        quality_preference: "   ",
      }),
    ).toThrow();
  });

  it("accepts controlled shopping intent statuses only", () => {
    for (const status of SHOPPING_INTENT_STATUSES) {
      expect(shoppingIntentStatusSchema.parse(status)).toBe(status);
      expect(
        shoppingIntentSchema.parse({ ...validIntent, status }).status,
      ).toBe(status);
    }
  });

  it("rejects unsupported intent statuses", () => {
    expect(() => shoppingIntentStatusSchema.parse("ACTIVE")).toThrow();
    expect(() => shoppingIntentStatusSchema.parse("EXTRACTED")).toThrow();
    expect(() => shoppingIntentStatusSchema.parse("CLOSED")).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        status: "CLARIFICATION_REQUIRED",
      }),
    ).toThrow();
  });

  it("accepts structured assumptions_json arrays", () => {
    expect(assumptionsJsonSchema.parse([])).toEqual([]);
    expect(
      assumptionsJsonSchema.parse([
        { key: "servings", value: 4 },
        "user did not specify brand",
      ]),
    ).toHaveLength(2);
    expect(
      shoppingIntentSchema.parse({
        ...validIntent,
        assumptions_json: [{ assumption: "servings inferred later" }],
      }).assumptions_json,
    ).toEqual([{ assumption: "servings inferred later" }]);
  });

  it("rejects non-array assumptions_json", () => {
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        assumptions_json: { hidden: true },
      }),
    ).toThrow();
  });

  it("accepts UTC timestamp-compatible created_at and updated_at", () => {
    const parsed = shoppingIntentSchema.parse({
      ...validIntent,
      created_at: "2026-09-05T06:10:00.123456Z",
      updated_at: "2026-09-05T06:15:00.999+00:00",
    });
    expect(Date.parse(parsed.created_at)).not.toBeNaN();
    expect(Date.parse(parsed.updated_at)).not.toBeNaN();
  });

  it("rejects malformed timestamps", () => {
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        created_at: "not-a-timestamp",
      }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        updated_at: "",
      }),
    ).toThrow();
  });

  it("rejects out-of-scope fields", () => {
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        requirement_id: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
      }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        product_id: "22222222-2222-4222-8222-222222222201",
      }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        sku_id: "33333333-3333-4333-8333-333333333301",
      }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        final_payable_minor: 87400,
      }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        policy_decision_id: "99999999-9999-4999-8999-999999999901",
      }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        basket_id: "88888888-8888-4888-8888-888888888801",
      }),
    ).toThrow();
    expect(() =>
      shoppingIntentSchema.parse({
        ...validIntent,
        currency: "INR",
      }),
    ).toThrow();

    const parsed = shoppingIntentSchema.parse(validIntent);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "assumptions_json",
        "budget_minor",
        "category",
        "created_at",
        "goal_text",
        "intent_id",
        "mandate_id",
        "quality_preference",
        "session_id",
        "status",
        "updated_at",
      ].sort(),
    );
  });
});
