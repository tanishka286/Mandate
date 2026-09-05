import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { mapDatabaseError } from "../../src/shared/errors/database.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";

const dairyCategory = {
  category_id: "11111111-1111-4111-8111-111111111101",
  code: "dairy",
  name: "Dairy",
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

const pantryCategory = {
  category_id: "11111111-1111-4111-8111-111111111102",
  code: "pantry",
  name: "Pantry",
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

const eggSkus = [
  {
    sku_id: "33333333-3333-4333-8333-333333333302",
    product_id: "22222222-2222-4222-8222-222222222201",
    sku_code: "FARM-EGGS-6",
    pack_quantity: 6,
    pack_unit: "pieces",
    price_minor: 3600,
    currency: "INR",
    status: "ACTIVE",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  },
  {
    sku_id: "33333333-3333-4333-8333-333333333301",
    product_id: "22222222-2222-4222-8222-222222222201",
    sku_code: "FARM-EGGS-2",
    pack_quantity: 2,
    pack_unit: "pieces",
    price_minor: 1200,
    currency: "INR",
    status: "ACTIVE",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  },
];

const eggStock = [
  {
    sku_id: "33333333-3333-4333-8333-333333333301",
    available_quantity: 48,
    updated_at: "2026-09-04T12:00:00.000Z",
  },
  {
    sku_id: "33333333-3333-4333-8333-333333333302",
    available_quantity: 24,
    updated_at: "2026-09-04T12:00:00.000Z",
  },
];

const breadSku = {
  sku_id: "33333333-3333-4333-8333-333333333307",
  product_id: "22222222-2222-4222-8222-222222222205",
  sku_code: "SANDWICH-BREAD-400G",
  pack_quantity: 400,
  pack_unit: "grams",
  price_minor: 4500,
  currency: "INR",
  status: "ACTIVE",
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

const breadStock = {
  sku_id: breadSku.sku_id,
  available_quantity: 0,
  updated_at: "2026-09-04T12:00:00.000Z",
};

const eggsProduct = {
  product_id: "22222222-2222-4222-8222-222222222201",
  name: "Farm Eggs",
  description: "Fresh farm eggs suitable for everyday cooking.",
  category_id: dairyCategory.category_id,
  brand: "FarmFresh",
  status: "ACTIVE",
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
  category: dairyCategory,
};

const breadProduct = {
  product_id: "22222222-2222-4222-8222-222222222205",
  name: "Sandwich Bread",
  description: "Soft sandwich loaf.",
  category_id: pantryCategory.category_id,
  brand: "BakeHouse",
  status: "ACTIVE",
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
  category: pantryCategory,
};

const stockStore = new Map<string, (typeof eggStock)[number]>(
  [...eggStock, breadStock].map((row) => [row.sku_id, row]),
);

vi.mock("../../src/config/supabase.js", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === "product") {
        return {
          select: () => ({
            eq: (_column: string, productId: string) => ({
              maybeSingle: async () => {
                if (productId === eggsProduct.product_id) {
                  return { data: eggsProduct, error: null };
                }
                if (productId === breadProduct.product_id) {
                  return { data: breadProduct, error: null };
                }
                return { data: null, error: null };
              },
            }),
          }),
        };
      }

      if (table === "sku") {
        return {
          select: () => ({
            eq: (column: string, value: string) => ({
              eq: (_statusColumn: string, _status: string) => ({
                order: async () => {
                  if (
                    column === "product_id" &&
                    value === eggsProduct.product_id
                  ) {
                    return { data: eggSkus, error: null };
                  }
                  if (
                    column === "product_id" &&
                    value === breadProduct.product_id
                  ) {
                    return { data: [breadSku], error: null };
                  }
                  return { data: [], error: null };
                },
              }),
            }),
          }),
          insert: (payload: { sku_code: string; product_id: string }) => ({
            select: () => ({
              single: async () => {
                if (payload.sku_code === "FARM-EGGS-2") {
                  return {
                    data: null,
                    error: {
                      code: "23505",
                      message:
                        'duplicate key value violates unique constraint "sku_code_unique"',
                    },
                  };
                }
                if (
                  payload.product_id ===
                  "99999999-9999-4999-8999-999999999999"
                ) {
                  return {
                    data: null,
                    error: {
                      code: "23503",
                      message:
                        'insert or update on table "sku" violates foreign key constraint',
                    },
                  };
                }
                return {
                  data: {
                    sku_id: "33333333-3333-4333-8333-333333333399",
                    ...payload,
                    currency: "INR",
                    status: "ACTIVE",
                    created_at: "2026-09-04T12:00:00.000Z",
                    updated_at: "2026-09-04T12:00:00.000Z",
                  },
                  error: null,
                };
              },
            }),
          }),
        };
      }

      if (table === "stock") {
        return {
          select: () => ({
            in: async (_column: string, skuIds: string[]) => ({
              data: skuIds
                .map((id) => stockStore.get(id))
                .filter(Boolean),
              error: null,
            }),
          }),
          insert: (payload: { sku_id: string; available_quantity: number }) => ({
            select: () => ({
              single: async () => {
                if (payload.sku_id === "99999999-9999-4999-8999-999999999999") {
                  return {
                    data: null,
                    error: {
                      code: "23503",
                      message:
                        'insert or update on table "stock" violates foreign key constraint',
                    },
                  };
                }
                if (stockStore.has(payload.sku_id)) {
                  return {
                    data: null,
                    error: {
                      code: "23505",
                      message:
                        'duplicate key value violates unique constraint "stock_pkey"',
                    },
                  };
                }
                if (payload.available_quantity < 0) {
                  return {
                    data: null,
                    error: {
                      code: "23514",
                      message:
                        'new row for relation "stock" violates check constraint "stock_available_quantity_non_negative"',
                    },
                  };
                }
                const row = {
                  sku_id: payload.sku_id,
                  available_quantity: payload.available_quantity,
                  updated_at: "2026-09-04T12:00:00.000Z",
                };
                stockStore.set(payload.sku_id, row);
                return { data: row, error: null };
              },
            }),
          }),
        };
      }

      if (table === "category") {
        return {
          select: () => ({
            order: async () => ({
              data: [dairyCategory, pantryCategory],
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

describe("GET /api/v1/products/:product_id with SKUs and stock", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns an existing product with category, SKUs, and stock", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      `/api/v1/products/${eggsProduct.product_id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: {
        product_id: eggsProduct.product_id,
        name: "Farm Eggs",
        category: { code: "dairy", name: "Dairy" },
        skus: [
          {
            sku_code: "FARM-EGGS-2",
            price_minor: 1200,
            stock: { available_quantity: 48 },
          },
          {
            sku_code: "FARM-EGGS-6",
            price_minor: 3600,
            stock: { available_quantity: 24 },
          },
        ],
      },
      meta: { request_id: expect.any(String) },
    });
    expect(res.body.data).not.toHaveProperty("evidence");
    expect(res.body.data).not.toHaveProperty("available_quantity");
    expect(res.body.data).not.toHaveProperty("price_minor");
  });

  it("returns zero-stock SKU correctly without fabricating availability", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      `/api/v1/products/${breadProduct.product_id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.skus).toEqual([
      expect.objectContaining({
        sku_code: "SANDWICH-BREAD-400G",
        status: "ACTIVE",
        stock: { available_quantity: 0 },
      }),
    ]);
  });

  it("orders SKUs deterministically by sku_code", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const first = await request(app).get(
      `/api/v1/products/${eggsProduct.product_id}`,
    );
    const second = await request(app).get(
      `/api/v1/products/${eggsProduct.product_id}`,
    );

    expect(
      first.body.data.skus.map((s: { sku_code: string }) => s.sku_code),
    ).toEqual(["FARM-EGGS-2", "FARM-EGGS-6"]);
    expect(first.body.data.skus).toEqual(second.body.data.skus);
  });

  it("keeps SKU prices as integer minor units", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      `/api/v1/products/${eggsProduct.product_id}`,
    );

    for (const sku of res.body.data.skus) {
      expect(Number.isInteger(sku.price_minor)).toBe(true);
      expect(sku.currency).toBe("INR");
    }
  });

  it("returns NOT_FOUND for a nonexistent product", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      "/api/v1/products/22222222-2222-4222-8222-222222222299",
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns VALIDATION_ERROR for an invalid product_id", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get("/api/v1/products/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate sku_code via database constraint mapping", async () => {
    const { CatalogRepository } = await import(
      "../../src/modules/catalog/repository.js"
    );
    const repository = new CatalogRepository();

    await expect(
      repository.insertSku({
        product_id: eggsProduct.product_id,
        sku_code: "FARM-EGGS-2",
        pack_quantity: 2,
        pack_unit: "pieces",
        price_minor: 1200,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
      statusCode: 409,
    });
  });

  it("rejects invalid product foreign key via database constraint mapping", async () => {
    const { CatalogRepository } = await import(
      "../../src/modules/catalog/repository.js"
    );
    const repository = new CatalogRepository();

    await expect(
      repository.insertSku({
        product_id: "99999999-9999-4999-8999-999999999999",
        sku_code: "ORPHAN-SKU-1",
        pack_quantity: 1,
        pack_unit: "pieces",
        price_minor: 100,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400,
    });
  });

  it("persists stock against an SKU and rejects duplicate stock rows", async () => {
    const { CatalogRepository } = await import(
      "../../src/modules/catalog/repository.js"
    );
    const repository = new CatalogRepository();

    const created = await repository.insertStock({
      sku_id: "33333333-3333-4333-8333-333333333399",
      available_quantity: 12,
    });
    expect(created.available_quantity).toBe(12);

    await expect(
      repository.insertStock({
        sku_id: "33333333-3333-4333-8333-333333333399",
        available_quantity: 5,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
      statusCode: 409,
    });
  });

  it("rejects stock with invalid SKU foreign key", async () => {
    const { CatalogRepository } = await import(
      "../../src/modules/catalog/repository.js"
    );
    const repository = new CatalogRepository();

    await expect(
      repository.insertStock({
        sku_id: "99999999-9999-4999-8999-999999999999",
        available_quantity: 1,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400,
    });
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

describe("SKU/stock constraint error mapping", () => {
  it("maps unique and FK failures without leaking internals", () => {
    const duplicate = mapDatabaseError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "stock_pkey"',
    });
    expect(duplicate.code).toBe(ErrorCodes.CONFLICT);
    expect(duplicate.message).not.toContain("stock_pkey");

    const fk = mapDatabaseError({
      code: "23503",
      message:
        'insert or update on table "stock" violates foreign key constraint',
    });
    expect(fk.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(fk.message).not.toContain("stock");
  });
});
