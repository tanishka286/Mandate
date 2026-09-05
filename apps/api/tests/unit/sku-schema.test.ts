import { describe, it, expect } from "vitest";
import {
  assertUniqueSkuCodes,
  currencySchema,
  packQuantitySchema,
  priceMinorSchema,
  skuIdSchema,
  skuSchema,
  skuStatusSchema,
} from "../../src/modules/catalog/schema.js";

const validSku = {
  sku_id: "33333333-3333-4333-8333-333333333301",
  product_id: "22222222-2222-4222-8222-222222222201",
  sku_code: "FARM-EGGS-2",
  pack_quantity: 2,
  pack_unit: "pieces",
  price_minor: 1200,
  currency: "INR" as const,
  status: "ACTIVE" as const,
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

describe("SKU schema validation", () => {
  it("accepts a valid SKU", () => {
    expect(skuSchema.parse(validSku).sku_code).toBe("FARM-EGGS-2");
  });

  it("validates sku_id and product_id as UUIDs", () => {
    expect(() => skuIdSchema.parse("not-a-uuid")).toThrow();
    expect(() =>
      skuSchema.parse({
        ...validSku,
        sku_id: "sku-001",
      }),
    ).toThrow();
    expect(() =>
      skuSchema.parse({
        ...validSku,
        product_id: "prod-001",
      }),
    ).toThrow();
  });

  it("rejects non-positive pack_quantity", () => {
    expect(() => packQuantitySchema.parse(0)).toThrow();
    expect(() => packQuantitySchema.parse(-1)).toThrow();
    expect(() =>
      skuSchema.parse({
        ...validSku,
        pack_quantity: 0,
      }),
    ).toThrow();
  });

  it("accepts decimal pack_quantity values", () => {
    expect(packQuantitySchema.parse(0.5)).toBe(0.5);
    expect(
      skuSchema.parse({
        ...validSku,
        pack_quantity: 0.5,
        pack_unit: "kg",
      }).pack_quantity,
    ).toBe(0.5);
  });

  it("rejects empty pack_unit", () => {
    expect(() =>
      skuSchema.parse({
        ...validSku,
        pack_unit: "",
      }),
    ).toThrow();
    expect(() =>
      skuSchema.parse({
        ...validSku,
        pack_unit: "   ",
      }),
    ).toThrow();
  });

  it("requires price_minor to be an integer >= 0", () => {
    expect(priceMinorSchema.parse(0)).toBe(0);
    expect(priceMinorSchema.parse(3600)).toBe(3600);
    expect(() => priceMinorSchema.parse(-1)).toThrow();
    expect(() => priceMinorSchema.parse(36.5)).toThrow();
  });

  it("rejects negative and float prices on skuSchema", () => {
    expect(() =>
      skuSchema.parse({
        ...validSku,
        price_minor: -100,
      }),
    ).toThrow();
    expect(() =>
      skuSchema.parse({
        ...validSku,
        price_minor: 12.5,
      }),
    ).toThrow();
  });

  it("requires currency INR", () => {
    expect(currencySchema.parse("INR")).toBe("INR");
    expect(() => currencySchema.parse("USD")).toThrow();
    expect(() =>
      skuSchema.parse({
        ...validSku,
        currency: "USD",
      }),
    ).toThrow();
  });

  it("rejects unsupported SKU status", () => {
    expect(() => skuStatusSchema.parse("DISCONTINUED")).toThrow();
    expect(() =>
      skuSchema.parse({
        ...validSku,
        status: "ARCHIVED",
      }),
    ).toThrow();
  });

  it("rejects empty sku_code", () => {
    expect(() =>
      skuSchema.parse({
        ...validSku,
        sku_code: "",
      }),
    ).toThrow();
  });

  it("detects duplicate sku_codes", () => {
    expect(() =>
      assertUniqueSkuCodes(["FARM-EGGS-2", "FARM-EGGS-6", "FARM-EGGS-2"]),
    ).toThrow(/Duplicate sku_code/);
  });

  it("does not define stock fields on SKU schema", () => {
    const parsed = skuSchema.parse(validSku);
    expect(parsed).not.toHaveProperty("stock");
    expect(parsed).not.toHaveProperty("available_quantity");
    expect(parsed).not.toHaveProperty("evidence");
  });
});
