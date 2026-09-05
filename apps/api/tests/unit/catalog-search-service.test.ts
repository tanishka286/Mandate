import { describe, it, expect } from "vitest";
import { CatalogService } from "../../src/modules/catalog/service.js";
import type { CatalogRepository } from "../../src/modules/catalog/repository.js";
import type { CatalogSearchRow } from "../../src/modules/catalog/types.js";

const eggRows: CatalogSearchRow[] = [
  {
    sku_id: "33333333-3333-4333-8333-333333333302",
    sku_code: "FARM-EGGS-6",
    pack_quantity: 6,
    pack_unit: "pieces",
    price_minor: 3600,
    currency: "INR",
    status: "ACTIVE",
    product: {
      product_id: "22222222-2222-4222-8222-222222222201",
      name: "Farm Eggs",
      status: "ACTIVE",
      category: { code: "dairy" },
    },
    stock: { available_quantity: 24 },
  },
  {
    sku_id: "33333333-3333-4333-8333-333333333301",
    sku_code: "FARM-EGGS-2",
    pack_quantity: 2,
    pack_unit: "pieces",
    price_minor: 1200,
    currency: "INR",
    status: "ACTIVE",
    product: {
      product_id: "22222222-2222-4222-8222-222222222201",
      name: "Farm Eggs",
      status: "ACTIVE",
      category: { code: "dairy" },
    },
    stock: { available_quantity: 48 },
  },
];

describe("CatalogService.searchCatalog", () => {
  it("returns items ordered by sku_code with authoritative prices and stock", async () => {
    const repository = {
      searchCatalog: async () => eggRows,
    } as CatalogRepository;

    const service = new CatalogService(repository);
    const result = await service.searchCatalog({ q: "eggs", limit: "20" });

    expect(result.items.map((i) => i.sku_code)).toEqual([
      "FARM-EGGS-2",
      "FARM-EGGS-6",
    ]);
    expect(result.items[0]).toMatchObject({
      name: "Farm Eggs",
      price_minor: 1200,
      currency: "INR",
      stock_available: 48,
    });
  });

  it("maps missing stock to null and zero stock to 0", async () => {
    const repository = {
      searchCatalog: async () => [
        {
          ...eggRows[0]!,
          sku_code: "FARM-EGGS-6",
          stock: null,
        },
        {
          ...eggRows[1]!,
          sku_code: "FARM-EGGS-2",
          stock: { available_quantity: 0 },
        },
      ],
    } as CatalogRepository;

    const service = new CatalogService(repository);
    const result = await service.searchCatalog({ q: "eggs" });

    expect(result.items.find((i) => i.sku_code === "FARM-EGGS-6")?.stock_available).toBeNull();
    expect(result.items.find((i) => i.sku_code === "FARM-EGGS-2")?.stock_available).toBe(0);
  });

  it("rejects invalid limit before repository access", async () => {
    const repository = {
      searchCatalog: async () => {
        throw new Error("repository should not be called");
      },
    } as CatalogRepository;

    const service = new CatalogService(repository);
    await expect(service.searchCatalog({ limit: "99" })).rejects.toThrow(
      /Validation failed/,
    );
  });

  it("treats whitespace-only q as no text filter", async () => {
    let received: { q?: string; categoryCode?: string; limit: number } | undefined;
    const repository = {
      searchCatalog: async (params: {
        q?: string;
        categoryCode?: string;
        limit: number;
      }) => {
        received = params;
        return [];
      },
    } as CatalogRepository;

    const service = new CatalogService(repository);
    await service.searchCatalog({ q: "   ", category: " dairy " });

    expect(received).toEqual({
      q: undefined,
      categoryCode: "dairy",
      limit: 20,
    });
  });
});
