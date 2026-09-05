import { describe, it, expect } from "vitest";
import {
  canTransition,
  transition,
  isApplicationOrderState,
  isPaymentOrderState,
  APPLICATION_ORDER_STATES,
} from "../../src/modules/cart/order-state.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";

describe("application order state machine", () => {
  it("defines Phase 1 states OPEN_CART and CANCELLED only", () => {
    expect(APPLICATION_ORDER_STATES).toEqual(["OPEN_CART", "CANCELLED"]);
  });

  it("allows OPEN_CART → OPEN_CART as idempotent no-op", () => {
    expect(canTransition("OPEN_CART", "OPEN_CART")).toBe(true);
    expect(transition("OPEN_CART", "OPEN_CART")).toBe("OPEN_CART");
  });

  it("allows OPEN_CART → CANCELLED", () => {
    expect(canTransition("OPEN_CART", "CANCELLED")).toBe(true);
    expect(transition("OPEN_CART", "CANCELLED")).toBe("CANCELLED");
  });

  it("rejects CANCELLED → OPEN_CART", () => {
    expect(canTransition("CANCELLED", "OPEN_CART")).toBe(false);
    expect(() => transition("CANCELLED", "OPEN_CART")).toThrow();
    try {
      transition("CANCELLED", "OPEN_CART");
    } catch (error) {
      expect(error).toMatchObject({
        code: ErrorCodes.CONFLICT,
        statusCode: 409,
      });
    }
  });

  it("allows CANCELLED → CANCELLED as idempotent no-op", () => {
    expect(canTransition("CANCELLED", "CANCELLED")).toBe(true);
    expect(transition("CANCELLED", "CANCELLED")).toBe("CANCELLED");
  });

  it("rejects arbitrary application states", () => {
    expect(isApplicationOrderState("SHIPPED")).toBe(false);
    expect(() => transition("OPEN_CART", "SHIPPED")).toThrow();
    expect(() => transition("WEIRD", "OPEN_CART")).toThrow();
  });

  it("rejects payment/provider states", () => {
    for (const state of [
      "CREATED",
      "PAYMENT_PENDING",
      "PAYMENT_VERIFIED",
      "PAYMENT_FAILED",
      "PAYMENT_CANCELLED",
      "PAYMENT_EXPIRED",
      "PAID",
      "AUTHORIZED",
    ]) {
      expect(isPaymentOrderState(state)).toBe(true);
      expect(() => transition("OPEN_CART", state)).toThrow();
      expect(() => transition(state, "CANCELLED")).toThrow();
    }
  });

  it("is deterministic for the same inputs", () => {
    expect(transition("OPEN_CART", "CANCELLED")).toBe(
      transition("OPEN_CART", "CANCELLED"),
    );
  });
});
