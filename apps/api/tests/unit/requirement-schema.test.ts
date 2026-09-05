import { describe, it, expect } from "vitest";
import {
  REQUIREMENT_STATUSES,
  confidenceSchema,
  constraintsJsonSchema,
  intentIdSchema,
  itemNameSchema,
  minimumQualitySchema,
  requirementIdSchema,
  requirementSchema,
  requirementStatusSchema,
  requirementUnitSchema,
  targetQuantitySchema,
} from "../../src/modules/requirements/schema.js";

/** Doc 08 pasta requirement fixture. */
const validRequirement = {
  requirement_id: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
  intent_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
  item_name: "pasta",
  target_quantity: 2,
  unit: "packs",
  minimum_quality: "acceptable" as string | null,
  constraints_json: [] as unknown[],
  confidence: 0.94 as number | null,
  status: "CREATED" as const,
  created_at: "2026-09-05T06:20:00.000Z",
  updated_at: "2026-09-05T06:20:00.000Z",
};

describe("requirement schema validation", () => {
  it("accepts a valid requirement fixture", () => {
    const parsed = requirementSchema.parse(validRequirement);
    expect(parsed.item_name).toBe("pasta");
    expect(parsed.target_quantity).toBe(2);
    expect(parsed.unit).toBe("packs");
    expect(parsed.status).toBe("CREATED");
  });

  it("validates requirement_id and intent_id as UUIDs", () => {
    expect(requirementIdSchema.parse(validRequirement.requirement_id)).toBe(
      validRequirement.requirement_id,
    );
    expect(intentIdSchema.parse(validRequirement.intent_id)).toBe(
      validRequirement.intent_id,
    );
  });

  it("rejects malformed UUIDs", () => {
    expect(() => requirementIdSchema.parse("req-001")).toThrow();
    expect(() => intentIdSchema.parse("intent-001")).toThrow();
    expect(() =>
      requirementSchema.parse({
        ...validRequirement,
        requirement_id: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      requirementSchema.parse({
        ...validRequirement,
        intent_id: "intent-1",
      }),
    ).toThrow();
  });

  it("accepts valid item_name values", () => {
    expect(itemNameSchema.parse("eggs")).toBe("eggs");
    expect(itemNameSchema.parse("pasta")).toBe("pasta");
    expect(itemNameSchema.parse("tomatoes")).toBe("tomatoes");
  });

  it("rejects empty and whitespace-only item_name", () => {
    expect(() => itemNameSchema.parse("")).toThrow();
    expect(() => itemNameSchema.parse("   ")).toThrow();
    expect(() =>
      requirementSchema.parse({ ...validRequirement, item_name: "" }),
    ).toThrow();
    expect(() =>
      requirementSchema.parse({ ...validRequirement, item_name: "   " }),
    ).toThrow();
  });

  it("accepts valid positive integer target_quantity", () => {
    expect(targetQuantitySchema.parse(6)).toBe(6);
    expect(
      requirementSchema.parse({ ...validRequirement, target_quantity: 6 })
        .target_quantity,
    ).toBe(6);
  });

  it("accepts valid positive decimal target_quantity", () => {
    expect(targetQuantitySchema.parse(1.5)).toBe(1.5);
    expect(
      requirementSchema.parse({ ...validRequirement, target_quantity: 1.5 })
        .target_quantity,
    ).toBe(1.5);
  });

  it("rejects zero target_quantity", () => {
    expect(() => targetQuantitySchema.parse(0)).toThrow();
    expect(() =>
      requirementSchema.parse({ ...validRequirement, target_quantity: 0 }),
    ).toThrow();
  });

  it("rejects negative target_quantity", () => {
    expect(() => targetQuantitySchema.parse(-1)).toThrow();
    expect(() =>
      requirementSchema.parse({ ...validRequirement, target_quantity: -2 }),
    ).toThrow();
  });

  it("accepts valid nonempty unit", () => {
    expect(requirementUnitSchema.parse("pieces")).toBe("pieces");
    expect(requirementUnitSchema.parse("packs")).toBe("packs");
  });

  it("rejects empty and whitespace-only unit", () => {
    expect(() => requirementUnitSchema.parse("")).toThrow();
    expect(() => requirementUnitSchema.parse("   ")).toThrow();
    expect(() =>
      requirementSchema.parse({ ...validRequirement, unit: "" }),
    ).toThrow();
    expect(() =>
      requirementSchema.parse({ ...validRequirement, unit: "  " }),
    ).toThrow();
  });

  it("allows nullable minimum_quality", () => {
    expect(minimumQualitySchema.parse(null)).toBeNull();
    expect(
      requirementSchema.parse({
        ...validRequirement,
        minimum_quality: null,
      }).minimum_quality,
    ).toBeNull();
    expect(
      requirementSchema.parse({
        ...validRequirement,
        minimum_quality: "acceptable",
      }).minimum_quality,
    ).toBe("acceptable");
  });

  it("accepts structured constraints_json arrays", () => {
    expect(constraintsJsonSchema.parse([])).toEqual([]);
    expect(
      constraintsJsonSchema.parse([
        { type: "brand", value: "Farm Fresh" },
        { type: "category", value: "dairy" },
      ]),
    ).toHaveLength(2);
    expect(
      requirementSchema.parse({
        ...validRequirement,
        constraints_json: [{ type: "brand", value: "Acme" }],
      }).constraints_json,
    ).toEqual([{ type: "brand", value: "Acme" }]);
  });

  it("allows nullable confidence within [0, 1]", () => {
    expect(confidenceSchema.parse(null)).toBeNull();
    expect(confidenceSchema.parse(0)).toBe(0);
    expect(confidenceSchema.parse(1)).toBe(1);
    expect(confidenceSchema.parse(0.94)).toBe(0.94);
    expect(
      requirementSchema.parse({ ...validRequirement, confidence: null })
        .confidence,
    ).toBeNull();
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() => confidenceSchema.parse(-0.1)).toThrow();
    expect(() => confidenceSchema.parse(1.01)).toThrow();
    expect(() =>
      requirementSchema.parse({ ...validRequirement, confidence: 2 }),
    ).toThrow();
  });

  it("accepts controlled requirement statuses only", () => {
    for (const status of REQUIREMENT_STATUSES) {
      expect(requirementStatusSchema.parse(status)).toBe(status);
      expect(
        requirementSchema.parse({ ...validRequirement, status }).status,
      ).toBe(status);
    }
  });

  it("rejects unsupported requirement statuses", () => {
    expect(() => requirementStatusSchema.parse("ACTIVE")).toThrow();
    expect(() => requirementStatusSchema.parse("EXTRACTED")).toThrow();
    expect(() => requirementStatusSchema.parse("OPTIMIZED")).toThrow();
    expect(() => requirementStatusSchema.parse("PLANNING")).toThrow();
    expect(() =>
      requirementSchema.parse({
        ...validRequirement,
        status: "FULFILLED",
      }),
    ).toThrow();
  });

  it("accepts UTC timestamp-compatible created_at and updated_at", () => {
    const parsed = requirementSchema.parse({
      ...validRequirement,
      created_at: "2026-09-05T06:20:00.123456Z",
      updated_at: "2026-09-05T06:25:00.999+00:00",
    });
    expect(Date.parse(parsed.created_at)).not.toBeNaN();
    expect(Date.parse(parsed.updated_at)).not.toBeNaN();
  });

  it("rejects malformed timestamps", () => {
    expect(() =>
      requirementSchema.parse({
        ...validRequirement,
        created_at: "not-a-timestamp",
      }),
    ).toThrow();
    expect(() =>
      requirementSchema.parse({
        ...validRequirement,
        updated_at: "",
      }),
    ).toThrow();
  });

  it("rejects out-of-scope commerce and authorization fields", () => {
    const forbidden = {
      product_id: "22222222-2222-4222-8222-222222222201",
      sku_id: "33333333-3333-4333-8333-333333333301",
      price: 36,
      price_minor: 3600,
      stock: 10,
      discount: 0,
      final_payable: 87400,
      basket_id: "88888888-8888-4888-8888-888888888801",
      optimization_run_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99",
      mandate_id: "77777777-7777-4777-8777-777777777701",
      policy_decision_id: "99999999-9999-4999-8999-999999999901",
      order_id: "11111111-1111-4111-8111-111111111199",
      payment_id: "22222222-2222-4222-8222-222222222299",
      razorpay_order_id: "order_test_123",
    } as const;

    for (const [key, value] of Object.entries(forbidden)) {
      expect(() =>
        requirementSchema.parse({
          ...validRequirement,
          [key]: value,
        }),
      ).toThrow();
    }

    const parsed = requirementSchema.parse(validRequirement);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "confidence",
        "constraints_json",
        "created_at",
        "intent_id",
        "item_name",
        "minimum_quality",
        "requirement_id",
        "status",
        "target_quantity",
        "unit",
        "updated_at",
      ].sort(),
    );
  });
});
