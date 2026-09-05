import { describe, it, expect } from "vitest";
import {
  applicationOrderSchema,
  applicationOrderStatusSchema,
  cartIdSchema,
  userIdSchema,
} from "../../src/modules/cart/schema.js";

const validOrder = {
  cart_id: "55555555-5555-4555-8555-555555555501",
  user_id: "44444444-4444-4444-8444-444444444401",
  status: "OPEN_CART" as const,
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

describe("application order schema", () => {
  it("accepts a valid application order (cart row)", () => {
    expect(applicationOrderSchema.parse(validOrder).status).toBe("OPEN_CART");
  });

  it("validates UUID primary key and user relationship fields", () => {
    expect(cartIdSchema.parse(validOrder.cart_id)).toBe(validOrder.cart_id);
    expect(userIdSchema.parse(validOrder.user_id)).toBe(validOrder.user_id);
    expect(() =>
      applicationOrderSchema.parse({ ...validOrder, cart_id: "not-uuid" }),
    ).toThrow();
    expect(() =>
      applicationOrderSchema.parse({ ...validOrder, user_id: "user-1" }),
    ).toThrow();
  });

  it("accepts valid Phase 1 states only", () => {
    expect(applicationOrderStatusSchema.parse("OPEN_CART")).toBe("OPEN_CART");
    expect(applicationOrderStatusSchema.parse("CANCELLED")).toBe("CANCELLED");
  });

  it("rejects invalid and payment states", () => {
    expect(() => applicationOrderStatusSchema.parse("PAYMENT_PENDING")).toThrow();
    expect(() => applicationOrderStatusSchema.parse("CREATED")).toThrow();
    expect(() =>
      applicationOrderSchema.parse({
        ...validOrder,
        status: "PAYMENT_VERIFIED",
      }),
    ).toThrow();
  });

  it("requires user_id and cart_id", () => {
    expect(() =>
      applicationOrderSchema.parse({
        status: "OPEN_CART",
        created_at: validOrder.created_at,
        updated_at: validOrder.updated_at,
      }),
    ).toThrow();
  });

  it("does not carry payment or financial snapshot columns", () => {
    const parsed = applicationOrderSchema.parse(validOrder);
    expect(parsed).not.toHaveProperty("razorpay_order_id");
    expect(parsed).not.toHaveProperty("final_payable_minor");
    expect(parsed).not.toHaveProperty("mandate_id");
    expect(parsed).not.toHaveProperty("payment_id");
  });
});
