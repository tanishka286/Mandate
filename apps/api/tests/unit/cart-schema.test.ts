import { describe, it, expect } from "vitest";
import {
  addCartItemBodySchema,
  cartItemIdSchema,
  cartItemSchema,
  cartQuantitySchema,
  cartSchema,
  cartWithItemsSchema,
  skuIdSchema,
  updateCartItemBodySchema,
} from "../../src/modules/cart/schema.js";

const validCartItem = {
  cart_item_id: "66666666-6666-4666-8666-666666666601",
  cart_id: "55555555-5555-4555-8555-555555555501",
  sku_id: "33333333-3333-4333-8333-333333333301",
  quantity: 2,
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

describe("cart item schema validation", () => {
  it("accepts a valid cart item", () => {
    expect(cartItemSchema.parse(validCartItem).quantity).toBe(2);
  });

  it("validates cart_item_id, cart_id, and sku_id as UUIDs", () => {
    expect(cartItemIdSchema.parse(validCartItem.cart_item_id)).toBe(
      validCartItem.cart_item_id,
    );
    expect(skuIdSchema.parse(validCartItem.sku_id)).toBe(validCartItem.sku_id);
    expect(() => cartItemIdSchema.parse("not-a-uuid")).toThrow();
    expect(() =>
      cartItemSchema.parse({ ...validCartItem, sku_id: "sku-001" }),
    ).toThrow();
  });

  it("requires quantity to be an integer >= 1", () => {
    expect(cartQuantitySchema.parse(1)).toBe(1);
    expect(cartQuantitySchema.parse(10)).toBe(10);
  });

  it("rejects decimal quantity", () => {
    expect(() => cartQuantitySchema.parse(1.5)).toThrow();
    expect(() =>
      cartItemSchema.parse({ ...validCartItem, quantity: 2.5 }),
    ).toThrow();
  });

  it("rejects zero quantity", () => {
    expect(() => cartQuantitySchema.parse(0)).toThrow();
  });

  it("rejects negative quantity", () => {
    expect(() => cartQuantitySchema.parse(-1)).toThrow();
  });

  it("rejects NaN, Infinity, and malformed quantity values", () => {
    expect(() => cartQuantitySchema.parse(Number.NaN)).toThrow();
    expect(() => cartQuantitySchema.parse(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => cartQuantitySchema.parse("2" as unknown as number)).toThrow();
    expect(() => cartQuantitySchema.parse(null as unknown as number)).toThrow();
  });

  it("rejects malformed UUIDs on add/update bodies", () => {
    expect(() =>
      addCartItemBodySchema.parse({
        sku_id: "bad",
        quantity: 1,
      }),
    ).toThrow();
    expect(() => updateCartItemBodySchema.parse({ quantity: 0 })).toThrow();
  });

  it("rejects client-supplied price/product fields on add body", () => {
    expect(() =>
      addCartItemBodySchema.parse({
        sku_id: validCartItem.sku_id,
        quantity: 1,
        price_minor: 1200,
      }),
    ).toThrow();
    expect(() =>
      addCartItemBodySchema.parse({
        sku_id: validCartItem.sku_id,
        quantity: 1,
        product_id: "22222222-2222-4222-8222-222222222201",
      }),
    ).toThrow();
  });

  it("priced cart schema requires integer totals and INR", () => {
    const foundation = cartSchema.parse({
      cart_id: validCartItem.cart_id,
      user_id: "44444444-4444-4444-8444-444444444401",
      status: "OPEN_CART",
      created_at: validCartItem.created_at,
      updated_at: validCartItem.updated_at,
    });

    const priced = cartWithItemsSchema.parse({
      ...foundation,
      items: [
        {
          cart_item_id: validCartItem.cart_item_id,
          sku_id: validCartItem.sku_id,
          product_id: "22222222-2222-4222-8222-222222222201",
          name: "Farm Eggs",
          sku_code: "FARM-EGGS-2",
          pack_quantity: 2,
          pack_unit: "pieces",
          quantity: 2,
          stock_available: 10,
          unit_price_minor: 1200,
          line_amount_minor: 2400,
        },
      ],
      gross_amount_minor: 2400,
      discount_amount_minor: 0,
      final_payable_minor: 2400,
      currency: "INR",
    });

    expect(priced.final_payable_minor).toBe(2400);
    expect(() =>
      cartWithItemsSchema.parse({
        ...priced,
        final_payable_minor: 24.5,
      }),
    ).toThrow();
  });
});
