import { describe, it, expect } from "vitest";
import {
  availableQuantitySchema,
  skuIdSchema,
  stockAvailabilitySchema,
  stockSchema,
} from "../../src/modules/catalog/schema.js";

describe("stock schema validation", () => {
  it("accepts a valid stock row", () => {
    const stock = stockSchema.parse({
      sku_id: "33333333-3333-4333-8333-333333333301",
      available_quantity: 24,
      updated_at: "2026-09-04T12:00:00.000Z",
    });
    expect(stock.available_quantity).toBe(24);
  });

  it("validates sku_id as UUID", () => {
    expect(() => skuIdSchema.parse("not-a-uuid")).toThrow();
    expect(() =>
      stockSchema.parse({
        sku_id: "sku-001",
        available_quantity: 1,
        updated_at: "2026-09-04T12:00:00.000Z",
      }),
    ).toThrow();
  });

  it("accepts zero quantity (out of stock)", () => {
    expect(availableQuantitySchema.parse(0)).toBe(0);
    expect(
      stockAvailabilitySchema.parse({ available_quantity: 0 }).available_quantity,
    ).toBe(0);
  });

  it("accepts decimal quantities", () => {
    expect(availableQuantitySchema.parse(0.5)).toBe(0.5);
  });

  it("rejects negative quantities", () => {
    expect(() => availableQuantitySchema.parse(-1)).toThrow();
    expect(() =>
      stockSchema.parse({
        sku_id: "33333333-3333-4333-8333-333333333301",
        available_quantity: -5,
        updated_at: "2026-09-04T12:00:00.000Z",
      }),
    ).toThrow();
  });

  it("does not treat stock quantity as money", () => {
    // Floats are allowed for quantity (unlike price_minor integers).
    expect(availableQuantitySchema.parse(12.25)).toBe(12.25);
  });
});
