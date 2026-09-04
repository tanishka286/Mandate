import { describe, it, expect } from "vitest";
import { assertMoneyMinor, paiseToDisplayRupees } from "../../src/shared/money/index.js";

describe("money helpers", () => {
  it("accepts integer paise", () => {
    expect(assertMoneyMinor(87400)).toBe(87400);
  });

  it("rejects floats", () => {
    expect(() => assertMoneyMinor(874.5)).toThrow(/integer/);
  });

  it("formats display rupees", () => {
    const rs = "\u20b9";
    expect(paiseToDisplayRupees(87400)).toBe(`${rs}874.00`);
    expect(paiseToDisplayRupees(101)).toBe(`${rs}1.01`);
  });
});
