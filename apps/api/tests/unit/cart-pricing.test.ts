import { describe, it, expect } from "vitest";
import {
  calculateCartPricing,
  calculateLineAmountMinor,
} from "../../src/modules/cart/pricing.js";

describe("cart pricing arithmetic", () => {
  it("calculates quantity × price as integer minor units", () => {
    expect(calculateLineAmountMinor(2, 1200)).toBe(2400);
    expect(calculateLineAmountMinor(6, 1200)).toBe(7200);
  });

  it("uses integer minor-unit arithmetic only", () => {
    const line = calculateLineAmountMinor(3, 199);
    expect(Number.isInteger(line)).toBe(true);
    expect(line).toBe(597);
  });

  it("rejects zero or non-integer quantity (invalid cart item state)", () => {
    expect(() => calculateLineAmountMinor(0, 1200)).toThrow();
    expect(() => calculateLineAmountMinor(1.5, 1200)).toThrow();
    expect(() => calculateLineAmountMinor(-1, 1200)).toThrow();
  });

  it("allows zero unit price", () => {
    expect(calculateLineAmountMinor(4, 0)).toBe(0);
  });

  it("sums multiple line items with discount 0 and final = gross", () => {
    const result = calculateCartPricing([
      { quantity: 2, price_minor: 1200, currency: "INR" },
      { quantity: 1, price_minor: 4500, currency: "INR" },
    ]);

    expect(result.lines).toEqual([
      { unit_price_minor: 1200, line_amount_minor: 2400, currency: "INR" },
      { unit_price_minor: 4500, line_amount_minor: 4500, currency: "INR" },
    ]);
    expect(result.gross_amount_minor).toBe(6900);
    expect(result.discount_amount_minor).toBe(0);
    expect(result.final_payable_minor).toBe(6900);
    expect(result.currency).toBe("INR");
  });

  it("never returns a negative final payable", () => {
    const result = calculateCartPricing([
      { quantity: 1, price_minor: 100, currency: "INR" },
    ]);
    expect(result.final_payable_minor).toBeGreaterThanOrEqual(0);
    expect(result.final_payable_minor).toBe(result.gross_amount_minor);
  });

  it("returns zero totals for an empty cart", () => {
    expect(calculateCartPricing([])).toEqual({
      lines: [],
      gross_amount_minor: 0,
      discount_amount_minor: 0,
      final_payable_minor: 0,
      currency: "INR",
    });
  });

  it("handles large integer values without floating-point error", () => {
    // 90_071_992 × 12 would lose precision with float multiply if misused.
    const price = 90_071_992;
    const quantity = 12;
    expect(calculateLineAmountMinor(quantity, price)).toBe(1_080_863_904);
  });

  it("rejects mixed or non-INR currency", () => {
    expect(() =>
      calculateCartPricing([
        { quantity: 1, price_minor: 100, currency: "USD" },
      ]),
    ).toThrow(/Unsupported currency/);
  });
});
