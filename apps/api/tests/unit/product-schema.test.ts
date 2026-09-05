import { describe, it, expect } from "vitest";
import {
  productDetailSchema,
  productIdSchema,
  productSchema,
  productStatusSchema,
} from "../../src/modules/catalog/schema.js";

const validProduct = {
  product_id: "22222222-2222-4222-8222-222222222201",
  name: "Farm Eggs",
  description: "Fresh farm eggs suitable for everyday cooking.",
  category_id: "11111111-1111-4111-8111-111111111101",
  brand: "FarmFresh",
  status: "ACTIVE" as const,
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

const validCategory = {
  category_id: "11111111-1111-4111-8111-111111111101",
  code: "dairy" as const,
  name: "Dairy",
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

const validSkuWithStock = {
  sku_id: "33333333-3333-4333-8333-333333333301",
  product_id: validProduct.product_id,
  sku_code: "FARM-EGGS-2",
  pack_quantity: 2,
  pack_unit: "pieces",
  price_minor: 1200,
  currency: "INR" as const,
  status: "ACTIVE" as const,
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
  stock: { available_quantity: 48 },
};

describe("product schema validation", () => {
  it("accepts a valid product", () => {
    expect(productSchema.parse(validProduct).name).toBe("Farm Eggs");
  });

  it("requires core identity fields", () => {
    expect(() =>
      productSchema.parse({
        ...validProduct,
        name: undefined,
        category_id: undefined,
        status: undefined,
      }),
    ).toThrow();
  });

  it("rejects invalid product UUID", () => {
    expect(() => productIdSchema.parse("not-a-uuid")).toThrow();
    expect(() =>
      productSchema.parse({
        ...validProduct,
        product_id: "prod-001",
      }),
    ).toThrow();
  });

  it("rejects unsupported status", () => {
    expect(() => productStatusSchema.parse("DISCONTINUED")).toThrow();
    expect(() =>
      productSchema.parse({
        ...validProduct,
        status: "ARCHIVED",
      }),
    ).toThrow();
  });

  it("rejects empty product name", () => {
    expect(() =>
      productSchema.parse({
        ...validProduct,
        name: "",
      }),
    ).toThrow();
    expect(() =>
      productSchema.parse({
        ...validProduct,
        name: "   ",
      }),
    ).toThrow();
  });

  it("accepts product detail with category, SKUs, and stock", () => {
    const detail = productDetailSchema.parse({
      ...validProduct,
      category: validCategory,
      skus: [validSkuWithStock],
    });
    expect(detail.category.code).toBe("dairy");
    expect(detail.skus[0]?.stock?.available_quantity).toBe(48);
  });

  it("allows null stock when no stock row exists", () => {
    const detail = productDetailSchema.parse({
      ...validProduct,
      category: validCategory,
      skus: [{ ...validSkuWithStock, stock: null }],
    });
    expect(detail.skus[0]?.stock).toBeNull();
  });

  it("does not define price or stock fields on product identity schema", () => {
    const parsed = productSchema.parse(validProduct);
    expect(parsed).not.toHaveProperty("price_minor");
    expect(parsed).not.toHaveProperty("price");
    expect(parsed).not.toHaveProperty("stock");
    expect(parsed).not.toHaveProperty("available_quantity");
    expect(parsed).not.toHaveProperty("sku_id");
  });
});
