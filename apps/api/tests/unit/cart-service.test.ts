import { describe, it, expect } from "vitest";
import { CartService } from "../../src/modules/cart/service.js";
import type { CartRepository } from "../../src/modules/cart/repository.js";
import type {
  CartItemRow,
  CartItemViewRow,
  CartRow,
  SkuEligibilityRow,
} from "../../src/modules/cart/types.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { mapDatabaseError } from "../../src/shared/errors/database.js";

const openCart: CartRow = {
  cart_id: "55555555-5555-4555-8555-555555555501",
  user_id: "44444444-4444-4444-8444-444444444401",
  status: "OPEN_CART",
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

const activeSku: SkuEligibilityRow = {
  sku_id: "33333333-3333-4333-8333-333333333301",
  sku_code: "FARM-EGGS-2",
  status: "ACTIVE",
  product_id: "22222222-2222-4222-8222-222222222201",
  product: {
    product_id: "22222222-2222-4222-8222-222222222201",
    name: "Farm Eggs",
    status: "ACTIVE",
  },
  stock: { available_quantity: 10 },
};

const cartItem: CartItemRow = {
  cart_item_id: "66666666-6666-4666-8666-666666666601",
  cart_id: openCart.cart_id,
  sku_id: activeSku.sku_id,
  quantity: 2,
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

function pricedViewRow(
  overrides: Partial<CartItemViewRow> & {
    quantity?: number;
    price_minor?: number;
    currency?: string;
    sku_status?: string;
    product_status?: string;
  } = {},
): CartItemViewRow {
  return {
    ...cartItem,
    quantity: overrides.quantity ?? cartItem.quantity,
    cart_item_id: overrides.cart_item_id ?? cartItem.cart_item_id,
    sku_id: overrides.sku_id ?? cartItem.sku_id,
    cart_id: overrides.cart_id ?? cartItem.cart_id,
    created_at: cartItem.created_at,
    updated_at: cartItem.updated_at,
    sku: {
      sku_id: overrides.sku_id ?? activeSku.sku_id,
      sku_code: activeSku.sku_code,
      pack_quantity: 2,
      pack_unit: "pieces",
      price_minor: overrides.price_minor ?? 1200,
      currency: overrides.currency ?? "INR",
      status: overrides.sku_status ?? "ACTIVE",
      product_id: activeSku.product_id,
      product: {
        product_id: activeSku.product_id,
        name: "Farm Eggs",
        status: overrides.product_status ?? "ACTIVE",
      },
      stock: { available_quantity: 10 },
    },
  };
}

describe("CartService.getOpenCartForUser pricing", () => {
  it("calculates the authenticated user's cart from current SKU prices", async () => {
    const repository = {
      findOpenCartByUserId: async (userId: string) =>
        userId === openCart.user_id ? openCart : null,
      listCartItemsWithCatalog: async () => [
        pricedViewRow({ quantity: 2, price_minor: 1200 }),
        pricedViewRow({
          cart_item_id: "66666666-6666-4666-8666-666666666602",
          sku_id: "33333333-3333-4333-8333-333333333302",
          quantity: 1,
          price_minor: 4500,
        }),
      ],
    } as unknown as CartRepository;

    const service = new CartService(repository);
    const cart = await service.getOpenCartForUser(openCart.user_id);

    expect(cart.items).toHaveLength(2);
    expect(cart.items[0]).toMatchObject({
      unit_price_minor: 1200,
      line_amount_minor: 2400,
      quantity: 2,
    });
    expect(cart.gross_amount_minor).toBe(6900);
    expect(cart.discount_amount_minor).toBe(0);
    expect(cart.final_payable_minor).toBe(6900);
    expect(cart.currency).toBe("INR");
  });

  it("returns zero totals for an empty cart", async () => {
    const repository = {
      findOpenCartByUserId: async () => openCart,
      listCartItemsWithCatalog: async () => [],
    } as unknown as CartRepository;

    const service = new CartService(repository);
    const cart = await service.getOpenCartForUser(openCart.user_id);
    expect(cart.items).toEqual([]);
    expect(cart.gross_amount_minor).toBe(0);
    expect(cart.discount_amount_minor).toBe(0);
    expect(cart.final_payable_minor).toBe(0);
    expect(cart.currency).toBe("INR");
  });

  it("reads the current SKU price (price changes are reflected)", async () => {
    let price = 1200;
    const repository = {
      findOpenCartByUserId: async () => openCart,
      listCartItemsWithCatalog: async () => [
        pricedViewRow({ quantity: 2, price_minor: price }),
      ],
    } as unknown as CartRepository;

    const service = new CartService(repository);
    const before = await service.getOpenCartForUser(openCart.user_id);
    expect(before.final_payable_minor).toBe(2400);

    price = 1500;
    const after = await service.getOpenCartForUser(openCart.user_id);
    expect(after.unit_price_minor ?? after.items[0]?.unit_price_minor).toBe(1500);
    expect(after.items[0]?.line_amount_minor).toBe(3000);
    expect(after.final_payable_minor).toBe(3000);
  });

  it("rejects inactive SKU when pricing", async () => {
    const repository = {
      findOpenCartByUserId: async () => openCart,
      listCartItemsWithCatalog: async () => [
        pricedViewRow({ sku_status: "INACTIVE" }),
      ],
    } as unknown as CartRepository;

    const service = new CartService(repository);
    await expect(
      service.getOpenCartForUser(openCart.user_id),
    ).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400,
    });
  });

  it("rejects inactive Product when pricing", async () => {
    const repository = {
      findOpenCartByUserId: async () => openCart,
      listCartItemsWithCatalog: async () => [
        pricedViewRow({ product_status: "INACTIVE" }),
      ],
    } as unknown as CartRepository;

    const service = new CartService(repository);
    await expect(
      service.getOpenCartForUser(openCart.user_id),
    ).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400,
    });
  });

  it("rejects mixed/non-INR currency safely", async () => {
    const repository = {
      findOpenCartByUserId: async () => openCart,
      listCartItemsWithCatalog: async () => [
        pricedViewRow({ currency: "USD" }),
      ],
    } as unknown as CartRepository;

    const service = new CartService(repository);
    await expect(
      service.getOpenCartForUser(openCart.user_id),
    ).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400,
    });
  });

  it("cannot price another user's cart (ownership gate)", async () => {
    const repository = {
      findOpenCartByUserId: async (userId: string) =>
        userId === openCart.user_id ? openCart : null,
      listCartItemsWithCatalog: async () => {
        throw new Error("should not list another cart");
      },
    } as unknown as CartRepository;

    const service = new CartService(repository);
    await expect(
      service.getOpenCartForUser("44444444-4444-4444-8444-444444444402"),
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
    });
  });

  it("returns NOT_FOUND when no active cart exists", async () => {
    const repository = {
      findOpenCartByUserId: async () => null,
      listCartItemsWithCatalog: async () => {
        throw new Error("should not list items");
      },
    } as unknown as CartRepository;

    const service = new CartService(repository);
    await expect(
      service.getOpenCartForUser(openCart.user_id),
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      statusCode: 404,
    });
  });
});

describe("CartService.addCartItem", () => {
  it("creates a cart item for an eligible SKU", async () => {
    const repository = {
      findOpenCartByUserId: async () => openCart,
      getSkuEligibility: async () => activeSku,
      findCartItemByCartAndSku: async () => null,
      insertCartItem: async (input: {
        cart_id: string;
        sku_id: string;
        quantity: number;
      }) => ({
        ...cartItem,
        cart_id: input.cart_id,
        sku_id: input.sku_id,
        quantity: input.quantity,
      }),
    } as unknown as CartRepository;

    const service = new CartService(repository);
    const item = await service.addCartItem(openCart.user_id, {
      sku_id: activeSku.sku_id,
      quantity: 2,
    });
    expect(item.quantity).toBe(2);
    expect(item).not.toHaveProperty("price_minor");
  });

  it("sets absolute quantity when SKU already exists (no duplicate row)", async () => {
    const repository = {
      findOpenCartByUserId: async () => openCart,
      getSkuEligibility: async () => activeSku,
      findCartItemByCartAndSku: async () => cartItem,
      updateCartItemQuantity: async (_id: string, quantity: number) => ({
        ...cartItem,
        quantity,
        updated_at: "2026-09-04T13:00:00.000Z",
      }),
      insertCartItem: async () => {
        throw new Error("must not insert duplicate");
      },
    } as unknown as CartRepository;

    const service = new CartService(repository);
    const item = await service.addCartItem(openCart.user_id, {
      sku_id: activeSku.sku_id,
      quantity: 5,
    });
    expect(item.quantity).toBe(5);
  });

  it("rejects inactive SKU", async () => {
    const repository = {
      findOpenCartByUserId: async () => openCart,
      getSkuEligibility: async () => ({ ...activeSku, status: "INACTIVE" }),
    } as unknown as CartRepository;

    const service = new CartService(repository);
    await expect(
      service.addCartItem(openCart.user_id, {
        sku_id: activeSku.sku_id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400,
    });
  });

  it("rejects quantity above stock", async () => {
    const repository = {
      findOpenCartByUserId: async () => openCart,
      getSkuEligibility: async () => activeSku,
    } as unknown as CartRepository;

    const service = new CartService(repository);
    await expect(
      service.addCartItem(openCart.user_id, {
        sku_id: activeSku.sku_id,
        quantity: 11,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.STOCK_UNAVAILABLE,
      statusCode: 422,
    });
  });
});

describe("CartService ownership", () => {
  it("forbids updating another user's cart item", async () => {
    const repository = {
      findCartItemById: async () => ({
        ...cartItem,
        cart: {
          cart_id: openCart.cart_id,
          user_id: openCart.user_id,
          status: "OPEN_CART",
        },
      }),
    } as unknown as CartRepository;

    const service = new CartService(repository);
    await expect(
      service.updateCartItem(
        "44444444-4444-4444-8444-444444444402",
        cartItem.cart_item_id,
        { quantity: 3 },
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.FORBIDDEN,
      statusCode: 403,
    });
  });
});

describe("CartService.cancelOpenCartForUser", () => {
  it("transitions OPEN_CART → CANCELLED for the owner", async () => {
    const repository = {
      findOpenCartByUserId: async (userId: string) =>
        userId === openCart.user_id ? openCart : null,
      updateCartStatus: async (cartId: string, status: string) => ({
        ...openCart,
        cart_id: cartId,
        status,
        updated_at: "2026-09-04T13:00:00.000Z",
      }),
    } as unknown as CartRepository;

    const service = new CartService(repository);
    const cancelled = await service.cancelOpenCartForUser(openCart.user_id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cart_id).toBe(openCart.cart_id);
    expect(cancelled.user_id).toBe(openCart.user_id);
  });

  it("cannot cancel another user's cart", async () => {
    const repository = {
      findOpenCartByUserId: async () => null,
      updateCartStatus: async () => {
        throw new Error("must not update");
      },
    } as unknown as CartRepository;

    const service = new CartService(repository);
    await expect(
      service.cancelOpenCartForUser("44444444-4444-4444-8444-444444444402"),
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
    });
  });
});

describe("cart database error mapping", () => {
  it("maps duplicate cart/SKU uniqueness to CONFLICT", () => {
    const err = mapDatabaseError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "cart_item_cart_sku_unique"',
    });
    expect(err.code).toBe(ErrorCodes.CONFLICT);
    expect(err.statusCode).toBe(409);
  });

  it("maps invalid cart/SKU FK to VALIDATION_ERROR", () => {
    const err = mapDatabaseError({
      code: "23503",
      message:
        'insert or update on table "cart_item" violates foreign key constraint',
    });
    expect(err.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(err.statusCode).toBe(400);
  });
});
