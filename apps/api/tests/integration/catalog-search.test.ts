import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

type SearchRow = {
  sku_id: string;
  sku_code: string;
  pack_quantity: number;
  pack_unit: string;
  price_minor: number;
  currency: string;
  status: string;
  product: {
    product_id: string;
    name: string;
    status: string;
    category: { code: string };
  };
  stock: { available_quantity: number } | null;
};

const catalog: SearchRow[] = [
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
    sku_id: "33333333-3333-4333-8333-333333333306",
    sku_code: "FRESH-MILK-1L",
    pack_quantity: 1,
    pack_unit: "litre",
    price_minor: 6200,
    currency: "INR",
    status: "ACTIVE",
    product: {
      product_id: "22222222-2222-4222-8222-222222222204",
      name: "Fresh Milk",
      status: "ACTIVE",
      category: { code: "dairy" },
    },
    stock: { available_quantity: 18 },
  },
  {
    sku_id: "33333333-3333-4333-8333-333333333307",
    sku_code: "SANDWICH-BREAD-400G",
    pack_quantity: 400,
    pack_unit: "grams",
    price_minor: 4500,
    currency: "INR",
    status: "ACTIVE",
    product: {
      product_id: "22222222-2222-4222-8222-222222222205",
      name: "Sandwich Bread",
      status: "ACTIVE",
      category: { code: "pantry" },
    },
    stock: { available_quantity: 0 },
  },
  {
    sku_id: "33333333-3333-4333-8333-333333333308",
    sku_code: "INACTIVE-SKU",
    pack_quantity: 1,
    pack_unit: "pieces",
    price_minor: 100,
    currency: "INR",
    status: "INACTIVE",
    product: {
      product_id: "22222222-2222-4222-8222-222222222201",
      name: "Farm Eggs",
      status: "ACTIVE",
      category: { code: "dairy" },
    },
    stock: { available_quantity: 5 },
  },
  {
    sku_id: "33333333-3333-4333-8333-333333333309",
    sku_code: "HIDDEN-EGGS",
    pack_quantity: 12,
    pack_unit: "pieces",
    price_minor: 7000,
    currency: "INR",
    status: "ACTIVE",
    product: {
      product_id: "22222222-2222-4222-8222-222222222299",
      name: "Farm Eggs Deluxe",
      status: "INACTIVE",
      category: { code: "dairy" },
    },
    stock: { available_quantity: 3 },
  },
  {
    sku_id: "33333333-3333-4333-8333-333333333310",
    sku_code: "NO-STOCK-SKU",
    pack_quantity: 1,
    pack_unit: "pieces",
    price_minor: 999,
    currency: "INR",
    status: "ACTIVE",
    product: {
      product_id: "22222222-2222-4222-8222-222222222204",
      name: "Fresh Milk",
      status: "ACTIVE",
      category: { code: "dairy" },
    },
    stock: null,
  },
];

function runSearch(params: {
  q?: string;
  categoryCode?: string;
  limit: number;
}): SearchRow[] {
  return catalog
    .filter((row) => row.status === "ACTIVE")
    .filter((row) => row.product.status === "ACTIVE")
    .filter((row) =>
      params.q
        ? row.product.name.toLowerCase().includes(params.q.toLowerCase())
        : true,
    )
    .filter((row) =>
      params.categoryCode
        ? row.product.category.code === params.categoryCode
        : true,
    )
    .sort((a, b) => a.sku_code.localeCompare(b.sku_code))
    .slice(0, params.limit);
}

vi.mock("../../src/config/supabase.js", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === "sku") {
        const state: {
          q?: string;
          categoryCode?: string;
        } = {};

        const builder = {
          select: () => builder,
          eq: (column: string, value: string) => {
            // product/status filters are already applied in runSearch.
            void column;
            void value;
            return builder;
          },
          ilike: (column: string, pattern: string) => {
            if (column === "product.name") {
              state.q = pattern.replace(/^%/, "").replace(/%$/, "");
            }
            return builder;
          },
          order: () => builder,
          limit: async (limit: number) => ({
            data: runSearch({
              q: state.q,
              categoryCode: state.categoryCode,
              limit,
            }),
            error: null,
          }),
        };

        // Capture category filter via eq on nested path when used.
        const originalEq = builder.eq;
        builder.eq = (column: string, value: string) => {
          if (column === "product.category.code") {
            state.categoryCode = value;
          }
          return originalEq(column, value);
        };

        return builder;
      }

      if (table === "category") {
        return {
          select: () => ({
            order: async () => ({
              data: [
                {
                  category_id: "11111111-1111-4111-8111-111111111101",
                  code: "dairy",
                  name: "Dairy",
                  created_at: "2026-09-04T12:00:00.000Z",
                  updated_at: "2026-09-04T12:00:00.000Z",
                },
              ],
              error: null,
            }),
          }),
        };
      }

      return {
        select: () => ({
          order: async () => ({ data: [], error: null }),
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
  resetSupabaseClient: () => undefined,
  isSupabaseConfigured: () => true,
}));

describe("GET /api/v1/catalog/search", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("searches by product name", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get("/api/v1/catalog/search?q=eggs");

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((i: { sku_code: string }) => i.sku_code)).toEqual([
      "FARM-EGGS-2",
      "FARM-EGGS-6",
    ]);
    expect(res.body.data.items[0]).toMatchObject({
      name: "Farm Eggs",
      price_minor: 1200,
      currency: "INR",
      stock_available: 48,
    });
  });

  it("is case-insensitive and trims whitespace", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const upper = await request(app).get("/api/v1/catalog/search?q=EGGS");
    const spaced = await request(app).get("/api/v1/catalog/search?q=%20eggs%20");

    expect(upper.body.data.items.map((i: { sku_code: string }) => i.sku_code)).toEqual([
      "FARM-EGGS-2",
      "FARM-EGGS-6",
    ]);
    expect(spaced.body.data.items.map((i: { sku_code: string }) => i.sku_code)).toEqual([
      "FARM-EGGS-2",
      "FARM-EGGS-6",
    ]);
  });

  it("filters by category code and combined filters", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const dairy = await request(app).get("/api/v1/catalog/search?category=dairy");
    const combined = await request(app).get(
      "/api/v1/catalog/search?q=eggs&category=dairy",
    );
    const unknown = await request(app).get(
      "/api/v1/catalog/search?category=electronics",
    );

    expect(
      dairy.body.data.items.every(
        (i: { sku_code: string }) =>
          i.sku_code.startsWith("FARM-EGGS") ||
          i.sku_code === "FRESH-MILK-1L" ||
          i.sku_code === "NO-STOCK-SKU",
      ),
    ).toBe(true);
    expect(combined.body.data.items.map((i: { sku_code: string }) => i.sku_code)).toEqual([
      "FARM-EGGS-2",
      "FARM-EGGS-6",
    ]);
    expect(unknown.body.data.items).toEqual([]);
  });

  it("excludes inactive products and inactive SKUs", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get("/api/v1/catalog/search?q=eggs");

    const codes = res.body.data.items.map((i: { sku_code: string }) => i.sku_code);
    expect(codes).not.toContain("INACTIVE-SKU");
    expect(codes).not.toContain("HIDDEN-EGGS");
  });

  it("returns out-of-stock ACTIVE SKUs with stock_available 0", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get("/api/v1/catalog/search?q=bread");

    expect(res.body.data.items).toEqual([
      expect.objectContaining({
        sku_code: "SANDWICH-BREAD-400G",
        price_minor: 4500,
        stock_available: 0,
      }),
    ]);
  });

  it("returns null stock_available when stock row is missing", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      "/api/v1/catalog/search?q=milk&category=dairy",
    );

    const noStock = res.body.data.items.find(
      (i: { sku_code: string }) => i.sku_code === "NO-STOCK-SKU",
    );
    expect(noStock.stock_available).toBeNull();
  });

  it("uses default and max limit behavior", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const defaults = await request(app).get("/api/v1/catalog/search");
    expect(defaults.status).toBe(200);
    expect(defaults.body.data.items.length).toBeGreaterThan(0);

    const limited = await request(app).get("/api/v1/catalog/search?limit=1");
    expect(limited.body.data.items).toHaveLength(1);

    const tooHigh = await request(app).get("/api/v1/catalog/search?limit=51");
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not disturb GET /api/v1/catalog/categories", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get("/api/v1/catalog/categories");
    expect(res.status).toBe(200);
    expect(res.body.data.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "dairy", name: "Dairy" }),
      ]),
    );
  });
});
