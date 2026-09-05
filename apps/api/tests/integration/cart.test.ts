import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ErrorCodes } from "../../src/shared/constants/index.js";

const JWT_SECRET = "test-jwt-secret-for-cart-items-phase1";

const userA = "44444444-4444-4444-8444-444444444401";
const userB = "44444444-4444-4444-8444-444444444402";
const userC = "44444444-4444-4444-8444-444444444403";

const cartAId = "55555555-5555-4555-8555-555555555501";
const cartBId = "55555555-5555-4555-8555-555555555502";

const productEggs = {
  product_id: "22222222-2222-4222-8222-222222222201",
  name: "Farm Eggs",
  status: "ACTIVE",
};

const productBread = {
  product_id: "22222222-2222-4222-8222-222222222205",
  name: "Sandwich Bread",
  status: "ACTIVE",
};

const skuEggs = {
  sku_id: "33333333-3333-4333-8333-333333333301",
  sku_code: "FARM-EGGS-2",
  pack_quantity: 2,
  pack_unit: "pieces",
  price_minor: 1200,
  currency: "INR",
  status: "ACTIVE",
  product_id: productEggs.product_id,
};

const skuEggs6 = {
  sku_id: "33333333-3333-4333-8333-333333333302",
  sku_code: "FARM-EGGS-6",
  pack_quantity: 6,
  pack_unit: "pieces",
  price_minor: 3200,
  currency: "INR",
  status: "ACTIVE",
  product_id: productEggs.product_id,
};

const skuBread = {
  sku_id: "33333333-3333-4333-8333-333333333307",
  sku_code: "SANDWICH-BREAD-400G",
  pack_quantity: 400,
  pack_unit: "g",
  price_minor: 4500,
  currency: "INR",
  status: "ACTIVE",
  product_id: productBread.product_id,
};

const skuInactive = {
  sku_id: "33333333-3333-4333-8333-333333333399",
  sku_code: "INACTIVE-SKU",
  pack_quantity: 1,
  pack_unit: "pieces",
  price_minor: 100,
  currency: "INR",
  status: "INACTIVE",
  product_id: productEggs.product_id,
};

const skuNoStock = {
  sku_id: "33333333-3333-4333-8333-333333333398",
  sku_code: "NO-STOCK-SKU",
  pack_quantity: 1,
  pack_unit: "pieces",
  price_minor: 100,
  currency: "INR",
  status: "ACTIVE",
  product_id: productEggs.product_id,
};

const skuInactiveProduct = {
  sku_id: "33333333-3333-4333-8333-333333333397",
  sku_code: "INACTIVE-PRODUCT-SKU",
  pack_quantity: 1,
  pack_unit: "pieces",
  price_minor: 100,
  currency: "INR",
  status: "ACTIVE",
  product_id: "22222222-2222-4222-8222-222222222299",
};

const inactiveProduct = {
  product_id: "22222222-2222-4222-8222-222222222299",
  name: "Retired Product",
  status: "INACTIVE",
};

type CartRow = {
  cart_id: string;
  user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type CartItemRow = {
  cart_item_id: string;
  cart_id: string;
  sku_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
};

const carts = new Map<string, CartRow>();
const cartItems = new Map<string, CartItemRow>();
const products = new Map<string, typeof productEggs>();
const skus = new Map<string, typeof skuEggs>();
const stock = new Map<string, number>();
const openCartCountByUser = new Map<string, number>();

let itemSeq = 0;

function resetStore(): void {
  carts.clear();
  cartItems.clear();
  products.clear();
  skus.clear();
  stock.clear();
  openCartCountByUser.clear();
  itemSeq = 0;

  carts.set(cartAId, {
    cart_id: cartAId,
    user_id: userA,
    status: "OPEN_CART",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  });
  carts.set(cartBId, {
    cart_id: cartBId,
    user_id: userB,
    status: "OPEN_CART",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  });
  openCartCountByUser.set(userA, 1);
  openCartCountByUser.set(userB, 1);

  for (const p of [productEggs, productBread, inactiveProduct]) {
    products.set(p.product_id, p);
  }
  for (const s of [
    skuEggs,
    skuEggs6,
    skuBread,
    skuInactive,
    skuNoStock,
    skuInactiveProduct,
  ]) {
    skus.set(s.sku_id, s);
  }
  stock.set(skuEggs.sku_id, 10);
  stock.set(skuEggs6.sku_id, 24);
  stock.set(skuBread.sku_id, 0);
  stock.set(skuInactive.sku_id, 5);
  stock.set(skuInactiveProduct.sku_id, 5);
}

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "1h" });
}

function skuEmbed(skuId: string) {
  const sku = skus.get(skuId);
  if (!sku) return null;
  const product = products.get(sku.product_id) ?? null;
  const available = stock.has(skuId) ? stock.get(skuId)! : null;
  return {
    sku_id: sku.sku_id,
    sku_code: sku.sku_code,
    pack_quantity: sku.pack_quantity,
    pack_unit: sku.pack_unit,
    price_minor: sku.price_minor,
    currency: sku.currency,
    status: sku.status,
    product_id: sku.product_id,
    product,
    stock:
      available === null ? null : { available_quantity: available },
  };
}

vi.mock("../../src/config/supabase.js", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === "cart") {
        return {
          select: () => {
            const filters: Array<[string, string]> = [];
            const chain = {
              eq: (column: string, value: string) => {
                filters.push([column, value]);
                return chain;
              },
              maybeSingle: async () => {
                let rows = [...carts.values()];
                for (const [column, value] of filters) {
                  rows = rows.filter(
                    (c) => (c as Record<string, string>)[column] === value,
                  );
                }
                return { data: rows[0] ?? null, error: null };
              },
            };
            return chain;
          },
          insert: (payload: {
            cart_id?: string;
            user_id: string;
            status?: string;
          }) => ({
            select: () => ({
              single: async () => {
                if (
                  payload.user_id ===
                  "99999999-9999-4999-8999-999999999999"
                ) {
                  return {
                    data: null,
                    error: {
                      code: "23503",
                      message:
                        'insert or update on table "cart" violates foreign key constraint',
                    },
                  };
                }
                const status = payload.status ?? "OPEN_CART";
                if (status === "OPEN_CART") {
                  const current = openCartCountByUser.get(payload.user_id) ?? 0;
                  if (current >= 1) {
                    return {
                      data: null,
                      error: {
                        code: "23505",
                        message:
                          'duplicate key value violates unique constraint "cart_one_open_per_user_idx"',
                      },
                    };
                  }
                  openCartCountByUser.set(payload.user_id, current + 1);
                }
                const row: CartRow = {
                  cart_id:
                    payload.cart_id ??
                    "55555555-5555-4555-8555-555555555599",
                  user_id: payload.user_id,
                  status,
                  created_at: "2026-09-04T12:00:00.000Z",
                  updated_at: "2026-09-04T12:00:00.000Z",
                };
                carts.set(row.cart_id, row);
                return { data: row, error: null };
              },
            }),
          }),
          update: (payload: { status: string; updated_at: string }) => ({
            eq: (_column: string, cartId: string) => ({
              select: () => ({
                single: async () => {
                  const existing = carts.get(cartId);
                  if (!existing) {
                    return {
                      data: null,
                      error: { code: "PGRST116", message: "not found" },
                    };
                  }
                  if (
                    existing.status === "OPEN_CART" &&
                    payload.status !== "OPEN_CART"
                  ) {
                    const current = openCartCountByUser.get(existing.user_id) ?? 1;
                    openCartCountByUser.set(
                      existing.user_id,
                      Math.max(0, current - 1),
                    );
                  }
                  const row = {
                    ...existing,
                    status: payload.status,
                    updated_at: payload.updated_at,
                  };
                  carts.set(cartId, row);
                  return { data: row, error: null };
                },
              }),
            }),
          }),
        };
      }

      if (table === "cart_item") {
        return {
          select: (columns: string) => {
            const withCatalog = columns.includes("sku (");
            const withCart = columns.includes("cart (");

            const eqFilters: Array<[string, string]> = [];
            const chain = {
              eq: (column: string, value: string) => {
                eqFilters.push([column, value]);
                return chain;
              },
              order: async () => {
                const cartId = eqFilters.find(([c]) => c === "cart_id")?.[1];
                const rows = [...cartItems.values()]
                  .filter((r) => (cartId ? r.cart_id === cartId : true))
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((r) =>
                    withCatalog
                      ? { ...r, sku: skuEmbed(r.sku_id) }
                      : r,
                  );
                return { data: rows, error: null };
              },
              maybeSingle: async () => {
                let rows = [...cartItems.values()];
                for (const [column, value] of eqFilters) {
                  rows = rows.filter(
                    (r) => (r as Record<string, string>)[column] === value,
                  );
                }
                const row = rows[0];
                if (!row) return { data: null, error: null };
                if (withCart) {
                  return {
                    data: {
                      ...row,
                      cart: carts.get(row.cart_id) ?? null,
                    },
                    error: null,
                  };
                }
                return { data: row, error: null };
              },
            };
            return chain;
          },
          insert: (payload: {
            cart_item_id?: string;
            cart_id: string;
            sku_id: string;
            quantity: number;
          }) => ({
            select: () => ({
              single: async () => {
                if (!carts.has(payload.cart_id)) {
                  return {
                    data: null,
                    error: {
                      code: "23503",
                      message:
                        'insert or update on table "cart_item" violates foreign key constraint "cart_item_cart_id_fkey"',
                    },
                  };
                }
                if (!skus.has(payload.sku_id)) {
                  return {
                    data: null,
                    error: {
                      code: "23503",
                      message:
                        'insert or update on table "cart_item" violates foreign key constraint "cart_item_sku_id_fkey"',
                    },
                  };
                }
                const duplicate = [...cartItems.values()].find(
                  (r) =>
                    r.cart_id === payload.cart_id &&
                    r.sku_id === payload.sku_id,
                );
                if (duplicate) {
                  return {
                    data: null,
                    error: {
                      code: "23505",
                      message:
                        'duplicate key value violates unique constraint "cart_item_cart_sku_unique"',
                    },
                  };
                }
                itemSeq += 1;
                const row: CartItemRow = {
                  cart_item_id:
                    payload.cart_item_id ??
                    `66666666-6666-4666-8666-${String(itemSeq).padStart(12, "0")}`,
                  cart_id: payload.cart_id,
                  sku_id: payload.sku_id,
                  quantity: payload.quantity,
                  created_at: "2026-09-04T12:00:00.000Z",
                  updated_at: "2026-09-04T12:00:00.000Z",
                };
                cartItems.set(row.cart_item_id, row);
                return { data: row, error: null };
              },
            }),
          }),
          update: (payload: { quantity: number; updated_at: string }) => ({
            eq: (_column: string, cartItemId: string) => ({
              select: () => ({
                single: async () => {
                  const existing = cartItems.get(cartItemId);
                  if (!existing) {
                    return {
                      data: null,
                      error: { code: "PGRST116", message: "not found" },
                    };
                  }
                  const row = {
                    ...existing,
                    quantity: payload.quantity,
                    updated_at: payload.updated_at,
                  };
                  cartItems.set(cartItemId, row);
                  return { data: row, error: null };
                },
              }),
            }),
          }),
          delete: () => ({
            eq: async (_column: string, cartItemId: string) => {
              cartItems.delete(cartItemId);
              return { error: null };
            },
          }),
        };
      }

      if (table === "sku") {
        return {
          select: () => ({
            eq: (_column: string, skuId: string) => ({
              maybeSingle: async () => {
                const sku = skus.get(skuId);
                if (!sku) return { data: null, error: null };
                return {
                  data: {
                    sku_id: sku.sku_id,
                    sku_code: sku.sku_code,
                    status: sku.status,
                    product_id: sku.product_id,
                    product: products.get(sku.product_id) ?? null,
                    stock: stock.has(skuId)
                      ? { available_quantity: stock.get(skuId)! }
                      : null,
                  },
                  error: null,
                };
              },
            }),
          }),
        };
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

async function loadApp() {
  const { loadEnv } = await import("../../src/config/env.js");
  loadEnv({
    NODE_ENV: "test",
    JWT_SECRET,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  });
  const { createApp } = await import("../../src/app.js");
  return createApp();
}

describe("Cart items API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.JWT_SECRET = JWT_SECRET;
    resetStore();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("repository integrity", () => {
    it("persists cart_item and enforces cart/SKU FKs and uniqueness", async () => {
      const { CartRepository } = await import(
        "../../src/modules/cart/repository.js"
      );
      const repository = new CartRepository();

      const created = await repository.insertCartItem({
        cart_id: cartAId,
        sku_id: skuEggs.sku_id,
        quantity: 2,
      });
      expect(created.quantity).toBe(2);
      expect(cartItems.has(created.cart_item_id)).toBe(true);

      await expect(
        repository.insertCartItem({
          cart_id: "99999999-9999-4999-8999-999999999901",
          sku_id: skuEggs.sku_id,
          quantity: 1,
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
        statusCode: 400,
      });

      await expect(
        repository.insertCartItem({
          cart_id: cartAId,
          sku_id: "99999999-9999-4999-8999-999999999902",
          quantity: 1,
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
        statusCode: 400,
      });

      await expect(
        repository.insertCartItem({
          cart_id: cartAId,
          sku_id: skuEggs.sku_id,
          quantity: 3,
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.CONFLICT,
        statusCode: 409,
      });

      const secondSku = await repository.insertCartItem({
        cart_id: cartAId,
        sku_id: skuEggs6.sku_id,
        quantity: 1,
      });
      expect(secondSku.sku_id).toBe(skuEggs6.sku_id);

      const otherUserItem = await repository.insertCartItem({
        cart_id: cartBId,
        sku_id: skuEggs.sku_id,
        quantity: 1,
      });
      expect(otherUserItem.cart_id).toBe(cartBId);
    });
  });

  describe("POST /api/v1/cart/items", () => {
    it("lets an authenticated user add an active SKU", async () => {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 2 });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        cart_id: cartAId,
        sku_id: skuEggs.sku_id,
        quantity: 2,
      });
      expect(res.body.data).not.toHaveProperty("price_minor");
      expect(res.body.data).not.toHaveProperty("subtotal_minor");
    });

    it("rejects unauthenticated requests", async () => {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .send({ sku_id: skuEggs.sku_id, quantity: 1 });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    });

    it("rejects inactive SKU", async () => {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuInactive.sku_id, quantity: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it("rejects inactive Product", async () => {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuInactiveProduct.sku_id, quantity: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it("rejects missing stock", async () => {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuNoStock.sku_id, quantity: 1 });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.STOCK_UNAVAILABLE);
    });

    it("rejects zero stock", async () => {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuBread.sku_id, quantity: 1 });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.STOCK_UNAVAILABLE);
    });

    it("rejects quantity above stock", async () => {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 11 });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.STOCK_UNAVAILABLE);
    });

    it("allows quantity exactly equal to stock", async () => {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 10 });
      expect(res.status).toBe(201);
      expect(res.body.data.quantity).toBe(10);
    });

    it("sets absolute quantity for duplicate SKU instead of inserting another row", async () => {
      const app = await loadApp();
      const first = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 2 });
      const second = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 4 });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.cart_item_id).toBe(first.body.data.cart_item_id);
      expect(second.body.data.quantity).toBe(4);
      expect(
        [...cartItems.values()].filter(
          (r) => r.cart_id === cartAId && r.sku_id === skuEggs.sku_id,
        ),
      ).toHaveLength(1);
    });
  });

  describe("PATCH /api/v1/cart/items/:cart_item_id", () => {
    async function seedItem(quantity = 2) {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity });
      return { app, item: res.body.data };
    }

    it("lets the owner update quantity", async () => {
      const { app, item } = await seedItem();
      const res = await request(app)
        .patch(`/api/v1/cart/items/${item.cart_item_id}`)
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ quantity: 3 });
      expect(res.status).toBe(200);
      expect(res.body.data.quantity).toBe(3);
    });

    it("rejects unauthenticated updates", async () => {
      const { app, item } = await seedItem();
      const res = await request(app)
        .patch(`/api/v1/cart/items/${item.cart_item_id}`)
        .send({ quantity: 3 });
      expect(res.status).toBe(401);
    });

    it("rejects another user updating the item", async () => {
      const { app, item } = await seedItem();
      const res = await request(app)
        .patch(`/api/v1/cart/items/${item.cart_item_id}`)
        .set("Authorization", `Bearer ${signToken(userB)}`)
        .send({ quantity: 3 });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it("rejects quantity above stock", async () => {
      const { app, item } = await seedItem();
      const res = await request(app)
        .patch(`/api/v1/cart/items/${item.cart_item_id}`)
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ quantity: 11 });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.STOCK_UNAVAILABLE);
    });

    it("rejects zero, negative, and decimal quantities", async () => {
      const { app, item } = await seedItem();
      for (const quantity of [0, -1, 1.5]) {
        const res = await request(app)
          .patch(`/api/v1/cart/items/${item.cart_item_id}`)
          .set("Authorization", `Bearer ${signToken(userA)}`)
          .send({ quantity });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  describe("DELETE /api/v1/cart/items/:cart_item_id", () => {
    it("lets the owner delete without mutating SKU or stock", async () => {
      const app = await loadApp();
      const created = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 2 });
      const stockBefore = stock.get(skuEggs.sku_id);

      const res = await request(app)
        .delete(`/api/v1/cart/items/${created.body.data.cart_item_id}`)
        .set("Authorization", `Bearer ${signToken(userA)}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        cart_item_id: created.body.data.cart_item_id,
        deleted: true,
      });
      expect(cartItems.has(created.body.data.cart_item_id)).toBe(false);
      expect(skus.has(skuEggs.sku_id)).toBe(true);
      expect(stock.get(skuEggs.sku_id)).toBe(stockBefore);
    });

    it("rejects unauthenticated delete", async () => {
      const app = await loadApp();
      const created = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 1 });
      const res = await request(app).delete(
        `/api/v1/cart/items/${created.body.data.cart_item_id}`,
      );
      expect(res.status).toBe(401);
    });

    it("rejects another user deleting the item", async () => {
      const app = await loadApp();
      const created = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 1 });
      const res = await request(app)
        .delete(`/api/v1/cart/items/${created.body.data.cart_item_id}`)
        .set("Authorization", `Bearer ${signToken(userB)}`);
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/v1/cart with items and pricing", () => {
    it("returns the authenticated user's items with catalog identity, stock, and pricing", async () => {
      const app = await loadApp();
      await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 2 });
      await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userB)}`)
        .send({ sku_id: skuEggs6.sku_id, quantity: 1 });

      const res = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", `Bearer ${signToken(userA)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user_id).toBe(userA);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({
        sku_id: skuEggs.sku_id,
        product_id: productEggs.product_id,
        name: "Farm Eggs",
        sku_code: "FARM-EGGS-2",
        pack_quantity: 2,
        pack_unit: "pieces",
        quantity: 2,
        stock_available: 10,
        unit_price_minor: 1200,
        line_amount_minor: 2400,
      });
      expect(res.body.data).toMatchObject({
        gross_amount_minor: 2400,
        discount_amount_minor: 0,
        final_payable_minor: 2400,
        currency: "INR",
      });
      expect(res.body.data).not.toHaveProperty("subtotal_minor");
      expect(
        res.body.data.items.some(
          (item: { sku_id: string }) => item.sku_id === skuEggs6.sku_id,
        ),
      ).toBe(false);
    });

    it("prices multiple items with correct gross and payable", async () => {
      const app = await loadApp();
      await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 2 });
      await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs6.sku_id, quantity: 1 });

      const res = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", `Bearer ${signToken(userA)}`);

      // 2×1200 + 1×3200 = 5600
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.gross_amount_minor).toBe(5600);
      expect(res.body.data.discount_amount_minor).toBe(0);
      expect(res.body.data.final_payable_minor).toBe(5600);
      expect(res.body.data.currency).toBe("INR");
    });

    it("returns zero totals for an empty cart", async () => {
      const app = await loadApp();
      const res = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", `Bearer ${signToken(userA)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.gross_amount_minor).toBe(0);
      expect(res.body.data.discount_amount_minor).toBe(0);
      expect(res.body.data.final_payable_minor).toBe(0);
      expect(res.body.data.currency).toBe("INR");
    });

    it("reflects authoritative SKU price changes immediately", async () => {
      const app = await loadApp();
      await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 6 });

      const before = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", `Bearer ${signToken(userA)}`);
      expect(before.body.data.items[0].unit_price_minor).toBe(1200);
      expect(before.body.data.items[0].line_amount_minor).toBe(7200);
      expect(before.body.data.final_payable_minor).toBe(7200);

      const stored = skus.get(skuEggs.sku_id)!;
      skus.set(skuEggs.sku_id, { ...stored, price_minor: 1500 });

      const after = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", `Bearer ${signToken(userA)}`);
      expect(after.body.data.items[0].unit_price_minor).toBe(1500);
      expect(after.body.data.items[0].line_amount_minor).toBe(9000);
      expect(after.body.data.final_payable_minor).toBe(9000);
    });

    it("ignores client-supplied financial query values", async () => {
      const app = await loadApp();
      await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({ sku_id: skuEggs.sku_id, quantity: 2 });

      const res = await request(app)
        .get(
          "/api/v1/cart?final_payable_minor=1&gross_amount_minor=1&discount_amount_minor=999&unit_price_minor=1",
        )
        .set("Authorization", `Bearer ${signToken(userA)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.gross_amount_minor).toBe(2400);
      expect(res.body.data.discount_amount_minor).toBe(0);
      expect(res.body.data.final_payable_minor).toBe(2400);
      expect(res.body.data.items[0].unit_price_minor).toBe(1200);
    });

    it("still requires auth and ignores client user_id", async () => {
      const app = await loadApp();
      const unauth = await request(app).get("/api/v1/cart");
      expect(unauth.status).toBe(401);

      const res = await request(app)
        .get(`/api/v1/cart?user_id=${userB}`)
        .set("Authorization", `Bearer ${signToken(userA)}`);
      expect(res.body.data.user_id).toBe(userA);
    });

    it("returns NOT_FOUND when user has no open cart", async () => {
      const app = await loadApp();
      const res = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", `Bearer ${signToken(userC)}`);
      expect(res.status).toBe(404);
    });

    it("does not disturb catalog categories", async () => {
      const app = await loadApp();
      const res = await request(app).get("/api/v1/catalog/categories");
      expect(res.status).toBe(200);
      expect(res.body.data.categories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "dairy", name: "Dairy" }),
        ]),
      );
    });
  });

  describe("application order state (cart.status)", () => {
    it("persists OPEN_CART for the owning user and exposes it on GET /cart", async () => {
      const app = await loadApp();
      const res = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", `Bearer ${signToken(userA)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("OPEN_CART");
      expect(res.body.data.user_id).toBe(userA);
      expect(res.body.data.cart_id).toBe(cartAId);
      expect(carts.get(cartAId)?.created_at).toBeTruthy();
      expect(carts.get(cartAId)?.updated_at).toBeTruthy();
    });

    it("cancels via server transition helper without a client status endpoint", async () => {
      const { CartService } = await import("../../src/modules/cart/service.js");
      const service = new CartService();
      const cancelled = await service.cancelOpenCartForUser(userA);
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.user_id).toBe(userA);
      expect(carts.get(cartAId)?.status).toBe("CANCELLED");

      const app = await loadApp();
      const res = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", `Bearer ${signToken(userA)}`);
      expect(res.status).toBe(404);
    });

    it("rejects client attempts to mutate status through cart item APIs", async () => {
      const app = await loadApp();
      const res = await request(app)
        .post("/api/v1/cart/items")
        .set("Authorization", `Bearer ${signToken(userA)}`)
        .send({
          sku_id: skuEggs.sku_id,
          quantity: 1,
          status: "CANCELLED",
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(carts.get(cartAId)?.status).toBe("OPEN_CART");
    });

    it("keeps application order state isolated across users", async () => {
      const { CartService } = await import("../../src/modules/cart/service.js");
      const service = new CartService();
      await service.cancelOpenCartForUser(userA);

      expect(carts.get(cartAId)?.status).toBe("CANCELLED");
      expect(carts.get(cartBId)?.status).toBe("OPEN_CART");

      const app = await loadApp();
      const res = await request(app)
        .get("/api/v1/cart")
        .set("Authorization", `Bearer ${signToken(userB)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("OPEN_CART");
      expect(res.body.data.user_id).toBe(userB);
    });

    it("enforces cart user FK on insert", async () => {
      const { CartRepository } = await import(
        "../../src/modules/cart/repository.js"
      );
      const repository = new CartRepository();
      await expect(
        repository.insertCart({
          user_id: "99999999-9999-4999-8999-999999999999",
          status: "OPEN_CART",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
        statusCode: 400,
      });
    });
  });
});
