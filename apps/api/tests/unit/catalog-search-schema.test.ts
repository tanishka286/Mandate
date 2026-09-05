import { describe, it, expect } from "vitest";
import {
  CATALOG_SEARCH_DEFAULT_LIMIT,
  CATALOG_SEARCH_MAX_LIMIT,
  catalogSearchItemSchema,
  catalogSearchQuerySchema,
  catalogSearchResultSchema,
} from "../../src/modules/catalog/schema.js";

describe("catalog search schema", () => {
  it("defaults limit to 20 and trims empty q/category", () => {
    const parsed = catalogSearchQuerySchema.parse({
      q: "  ",
      category: "   ",
    });
    expect(parsed.q).toBeUndefined();
    expect(parsed.category).toBeUndefined();
    expect(parsed.limit).toBe(CATALOG_SEARCH_DEFAULT_LIMIT);
  });

  it("trims q and category", () => {
    const parsed = catalogSearchQuerySchema.parse({
      q: " eggs ",
      category: " dairy ",
      limit: "10",
    });
    expect(parsed.q).toBe("eggs");
    expect(parsed.category).toBe("dairy");
    expect(parsed.limit).toBe(10);
  });

  it("rejects limit above max and below 1", () => {
    expect(() =>
      catalogSearchQuerySchema.parse({ limit: CATALOG_SEARCH_MAX_LIMIT + 1 }),
    ).toThrow();
    expect(() => catalogSearchQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => catalogSearchQuerySchema.parse({ limit: 1.5 })).toThrow();
  });

  it("accepts a search item with null or zero stock_available", () => {
    const base = {
      product_id: "22222222-2222-4222-8222-222222222201",
      sku_id: "33333333-3333-4333-8333-333333333301",
      name: "Farm Eggs",
      sku_code: "FARM-EGGS-2",
      pack_quantity: 2,
      pack_unit: "pieces",
      price_minor: 1200,
      currency: "INR" as const,
      category_code: "dairy",
      product_status: "ACTIVE" as const,
      sku_status: "ACTIVE" as const,
      brand: "FarmFresh",
    };
    expect(
      catalogSearchItemSchema.parse({ ...base, stock_available: null })
        .stock_available,
    ).toBeNull();
    expect(
      catalogSearchItemSchema.parse({ ...base, stock_available: 0 })
        .stock_available,
    ).toBe(0);
  });

  it("rejects float price_minor on search items", () => {
    expect(() =>
      catalogSearchItemSchema.parse({
        product_id: "22222222-2222-4222-8222-222222222201",
        sku_id: "33333333-3333-4333-8333-333333333301",
        name: "Farm Eggs",
        sku_code: "FARM-EGGS-2",
        pack_quantity: 2,
        pack_unit: "pieces",
        price_minor: 12.5,
        currency: "INR",
        category_code: "dairy",
        product_status: "ACTIVE",
        sku_status: "ACTIVE",
        brand: null,
        stock_available: 1,
      }),
    ).toThrow();
  });

  it("accepts a search result envelope payload", () => {
    const result = catalogSearchResultSchema.parse({
      items: [
        {
          product_id: "22222222-2222-4222-8222-222222222201",
          sku_id: "33333333-3333-4333-8333-333333333301",
          name: "Farm Eggs",
          sku_code: "FARM-EGGS-2",
          pack_quantity: 2,
          pack_unit: "pieces",
          price_minor: 1200,
          currency: "INR",
          category_code: "dairy",
          product_status: "ACTIVE",
          sku_status: "ACTIVE",
          brand: "FarmFresh",
          stock_available: 48,
        },
      ],
    });
    expect(result.items).toHaveLength(1);
  });
});
