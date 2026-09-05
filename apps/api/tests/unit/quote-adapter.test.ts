import { describe, it, expect } from "vitest";
import { UnavailableQuoteAdapter } from "../../src/modules/policy/quote-adapter.js";

describe("UnavailableQuoteAdapter", () => {
  it("fails closed for any quote_version (no invented authoritative quote)", async () => {
    const adapter = new UnavailableQuoteAdapter();
    const result = await adapter.resolve({
      user_id: "44444444-4444-4444-8444-444444444401",
      basket_id: "77777777-7777-4777-8777-777777777701",
      quote_version: "quote-with-claimed-amounts-ignored",
    });
    expect(result).toBeNull();
  });
});
