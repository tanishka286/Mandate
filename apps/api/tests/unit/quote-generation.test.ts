import { describe, it, expect } from "vitest";
import {
  generateQuote,
  deriveQuoteVersion,
  isApplicableCurrentIncentive,
  QUOTE_AMOUNT_KIND,
  type QuoteCalculationInputRaw,
  type QuoteIncentiveInput,
} from "../../src/modules/quote/index.js";

const SKU_A = "33333333-3333-4333-8333-333333333301";
const SKU_B = "33333333-3333-4333-8333-333333333302";
const BASKET = "basket-value-001";

function catalog(
  sku_id: string,
  price_minor: number,
  available_quantity: number | null = 100,
  overrides: Record<string, unknown> = {},
) {
  return {
    sku_id,
    price_minor,
    currency: "INR" as const,
    available_quantity,
    sku_status: "ACTIVE",
    product_status: "ACTIVE",
    ...overrides,
  };
}

function voucher(
  overrides: Partial<QuoteIncentiveInput> & Pick<QuoteIncentiveInput, "incentive_id">,
): QuoteIncentiveInput {
  return {
    kind: "VOUCHER",
    decision: "USE_NOW",
    validity: "VALID",
    eligibility: "ELIGIBLE",
    benefit_minor: 5000,
    ...overrides,
  };
}

function loyalty(
  overrides: Partial<QuoteIncentiveInput> & Pick<QuoteIncentiveInput, "incentive_id">,
): QuoteIncentiveInput {
  return {
    kind: "LOYALTY",
    decision: "USE_NOW",
    validity: "VALID",
    eligibility: "ELIGIBLE",
    benefit_minor: 2000,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<QuoteCalculationInputRaw> = {},
): QuoteCalculationInputRaw {
  return {
    basket_id: BASKET,
    currency: "INR",
    items: [{ sku_id: SKU_A, quantity: 2 }],
    catalog: [catalog(SKU_A, 10000)],
    incentives: [],
    ...overrides,
  };
}

describe("Phase 5 Step 10 — Deterministic quote generation", () => {
  it("TEST 1 — Basic authoritative quote", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 2 }],
        catalog: [catalog(SKU_A, 10000)],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gross_amount_minor).toBe(20000);
    expect(result.discount_amount_minor).toBe(0);
    expect(result.final_payable_minor).toBe(20000);
    expect(result.amount_kind).toBe(QUOTE_AMOUNT_KIND);
  });

  it("TEST 2 — Multiple line items sum exactly", () => {
    const result = generateQuote(
      baseInput({
        items: [
          { sku_id: SKU_A, quantity: 2 },
          { sku_id: SKU_B, quantity: 3 },
        ],
        catalog: [catalog(SKU_A, 10000), catalog(SKU_B, 2500)],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gross_amount_minor).toBe(2 * 10000 + 3 * 2500);
    expect(result.final_payable_minor).toBe(result.gross_amount_minor);
  });

  it("TEST 3 — Current price changed (stale optimization price ignored)", () => {
    const result = generateQuote(
      baseInput({
        items: [
          {
            sku_id: SKU_A,
            quantity: 1,
            snapshot_unit_price_minor: 10000,
          },
        ],
        catalog: [catalog(SKU_A, 12000)],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]?.unit_price_minor).toBe(12000);
    expect(result.final_payable_minor).toBe(12000);
  });

  it("TEST 4 — Stock changed → STOCK_UNAVAILABLE", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 5 }],
        catalog: [catalog(SKU_A, 10000, 2)],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe("STOCK_UNAVAILABLE");
  });

  it("TEST 5 — Valid voucher applied", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 2 }],
        catalog: [catalog(SKU_A, 10000)],
        incentives: [voucher({ incentive_id: "voucher-001", benefit_minor: 5000 })],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gross_amount_minor).toBe(20000);
    expect(result.discount_amount_minor).toBe(5000);
    expect(result.final_payable_minor).toBe(15000);
    expect(result.applied_incentives).toHaveLength(1);
  });

  it("TEST 6 — Expired voucher not applied", () => {
    const result = generateQuote(
      baseInput({
        incentives: [
          voucher({
            incentive_id: "voucher-expired",
            validity: "EXPIRED",
            benefit_minor: 5000,
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount_amount_minor).toBe(0);
    expect(result.final_payable_minor).toBe(20000);
    expect(result.applied_incentives).toHaveLength(0);
  });

  it("TEST 7 — Ineligible voucher not applied", () => {
    const result = generateQuote(
      baseInput({
        incentives: [
          voucher({
            incentive_id: "voucher-inelig",
            eligibility: "INELIGIBLE",
            benefit_minor: 5000,
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount_amount_minor).toBe(0);
  });

  it("TEST 8 — SAVE_FOR_LATER confers no quote discount", () => {
    const result = generateQuote(
      baseInput({
        incentives: [
          voucher({
            incentive_id: "voucher-save",
            decision: "SAVE_FOR_LATER",
            benefit_minor: 5000,
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount_amount_minor).toBe(0);
    expect(isApplicableCurrentIncentive(
      voucher({
        incentive_id: "voucher-save",
        decision: "SAVE_FOR_LATER",
        benefit_minor: 5000,
      }),
    )).toBe(false);
  });

  it("TEST 9 — DO_NOT_USE confers no quote discount", () => {
    const result = generateQuote(
      baseInput({
        incentives: [
          voucher({
            incentive_id: "voucher-dnu",
            decision: "DO_NOT_USE",
            benefit_minor: 8000,
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount_amount_minor).toBe(0);
  });

  it("TEST 10 — Duplicate incentive applied once", () => {
    const result = generateQuote(
      baseInput({
        incentives: [
          voucher({ incentive_id: "voucher-001", benefit_minor: 5000 }),
          voucher({ incentive_id: "voucher-001", benefit_minor: 5000 }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount_amount_minor).toBe(5000);
    expect(result.applied_incentives).toHaveLength(1);
  });

  it("TEST 11 — Loyalty current benefit applied once", () => {
    const result = generateQuote(
      baseInput({
        incentives: [
          loyalty({ incentive_id: "reward-001", benefit_minor: 3000 }),
          loyalty({ incentive_id: "reward-001", benefit_minor: 3000 }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount_amount_minor).toBe(3000);
    expect(result.applied_incentives[0]?.kind).toBe("LOYALTY");
  });

  it("TEST 12 — Discount cannot exceed gross", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 1 }],
        catalog: [catalog(SKU_A, 10000)],
        incentives: [
          voucher({ incentive_id: "voucher-big", benefit_minor: 10001 }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe("INVALID_QUOTE_STATE");
  });

  it("TEST 13 — Final payable cannot be negative", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 1 }],
        catalog: [catalog(SKU_A, 5000)],
        incentives: [
          voucher({ incentive_id: "v1", benefit_minor: 3000 }),
          loyalty({ incentive_id: "r1", benefit_minor: 3000 }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe("INVALID_QUOTE_STATE");
  });

  it("TEST 14 — Integer minor-unit arithmetic (no float ambiguity)", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 3 }],
        catalog: [catalog(SKU_A, 3333)],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gross_amount_minor).toBe(9999);
    expect(Number.isInteger(result.gross_amount_minor)).toBe(true);
    expect(Number.isInteger(result.final_payable_minor)).toBe(true);
  });

  it("TEST 15 — Exact boundary discount = gross → final 0", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 1 }],
        catalog: [catalog(SKU_A, 10000)],
        incentives: [
          voucher({ incentive_id: "full", benefit_minor: 10000 }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gross_amount_minor).toBe(10000);
    expect(result.discount_amount_minor).toBe(10000);
    expect(result.final_payable_minor).toBe(0);
  });

  it("TEST 16 — One paise over discount is invalid", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 1 }],
        catalog: [catalog(SKU_A, 10000)],
        incentives: [
          voucher({ incentive_id: "over", benefit_minor: 10001 }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe("INVALID_QUOTE_STATE");
  });

  it("TEST 17 — Negative quantity → validation failure", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: -1 as unknown as number }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe("VALIDATION_ERROR");
  });

  it("TEST 18 — Missing authoritative price → AMOUNT_CALCULATION_FAILED or SKU_MISSING", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 1 }],
        catalog: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["AMOUNT_CALCULATION_FAILED", "SKU_MISSING"]).toContain(
      result.reason_code,
    );
  });

  it("TEST 19 — Currency mismatch", () => {
    const result = generateQuote(
      baseInput({
        catalog: [
          {
            sku_id: SKU_A,
            price_minor: 10000,
            currency: "USD",
            available_quantity: 10,
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe("CURRENCY_MISMATCH");
  });

  it("TEST 20 — Client/manipulated totals ignored", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 2 }],
        catalog: [catalog(SKU_A, 10000)],
        client_claims: {
          gross_amount_minor: 1,
          discount_amount_minor: 0,
          final_payable_minor: 1,
          unit_prices: { [SKU_A]: 1 },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gross_amount_minor).toBe(20000);
    expect(result.final_payable_minor).toBe(20000);
  });

  it("TEST 21 — Practical optimization cost boundary", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 1 }],
        catalog: [catalog(SKU_A, 60000)],
        practical_cost_minor: 50000,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.final_payable_minor).toBe(60000);
    expect(result.amount_kind).toBe("AUTHORITATIVE_QUOTE");
    expect(JSON.stringify(result)).not.toContain("practical_cost_minor");
  });

  it("TEST 22 — Over-budget quote still calculates; no Policy DENY", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 1 }],
        catalog: [catalog(SKU_A, 150000)],
        mandate_max_spend_minor: 100000,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.final_payable_minor).toBe(150000);
    expect(result.policy_decision).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/"ALLOW"|"DENY"/);
  });

  it("TEST 23 — No optimization (does not add/remove/substitute products)", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 1 }],
        catalog: [catalog(SKU_A, 10000), catalog(SKU_B, 5000)],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.sku_id).toBe(SKU_A);
  });

  it("TEST 24 — No payment / Razorpay", () => {
    const result = generateQuote(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment_created).toBe(false);
    expect(Object.keys(result)).not.toContain("razorpay");
    expect(Object.keys(result)).not.toContain("payment_id");
    expect(Object.keys(result)).not.toContain("order_id");
  });

  it("TEST 25 — Determinism", () => {
    const input = baseInput({
      incentives: [voucher({ incentive_id: "v1", benefit_minor: 1000 })],
    });
    const a = generateQuote(input);
    const b = generateQuote(input);
    const c = generateQuote(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    if (a.ok && b.ok) {
      expect(a.quote_version).toBe(b.quote_version);
      expect(a.quote_version).toMatch(/^quote-[a-f0-9]{16}$/);
    }
  });

  it("TEST 26 — Line amount = current unit price × quantity", () => {
    const result = generateQuote(
      baseInput({
        items: [{ sku_id: SKU_A, quantity: 4 }],
        catalog: [catalog(SKU_A, 1250)],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]?.line_amount_minor).toBe(5000);
  });

  it("TEST 27 — Gross/discount/final invariant", () => {
    const result = generateQuote(
      baseInput({
        incentives: [voucher({ incentive_id: "v1", benefit_minor: 2500 })],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.final_payable_minor).toBe(
      result.gross_amount_minor - result.discount_amount_minor,
    );
  });

  it("TEST 28 — Discount once per benefit_identity", () => {
    const result = generateQuote(
      baseInput({
        incentives: [
          voucher({
            incentive_id: "v1",
            benefit_minor: 2000,
            benefit_identity: "deal-x",
          }),
          loyalty({
            incentive_id: "r1",
            benefit_minor: 2000,
            benefit_identity: "deal-x",
          }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount_amount_minor).toBe(2000);
    expect(result.applied_incentives).toHaveLength(1);
  });

  it("TEST 29 — Fresh authoritative quote changes with price", () => {
    const low = generateQuote(
      baseInput({ catalog: [catalog(SKU_A, 10000)] }),
    );
    const high = generateQuote(
      baseInput({ catalog: [catalog(SKU_A, 12000)] }),
    );
    expect(low.ok && high.ok).toBe(true);
    if (!low.ok || !high.ok) return;
    expect(low.final_payable_minor).toBe(20000);
    expect(high.final_payable_minor).toBe(24000);
    expect(low.quote_version).not.toBe(high.quote_version);
  });

  it("TEST 30 — Quote does not authorize", () => {
    const result = generateQuote(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy_decision).toBeNull();
    expect(result.payment_created).toBe(false);
    expect(result.selection_created).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/"ALLOW"|"DENY"/);
  });

  it("deriveQuoteVersion is stable for identical payloads", () => {
    const lines = [
      {
        sku_id: SKU_A,
        quantity: 1,
        unit_price_minor: 100,
        line_amount_minor: 100,
      },
    ];
    const a = deriveQuoteVersion({
      basket_id: BASKET,
      currency: "INR",
      lines,
      gross_amount_minor: 100,
      discount_amount_minor: 0,
      final_payable_minor: 100,
      applied_incentives: [],
    });
    const b = deriveQuoteVersion({
      basket_id: BASKET,
      currency: "INR",
      lines,
      gross_amount_minor: 100,
      discount_amount_minor: 0,
      final_payable_minor: 100,
      applied_incentives: [],
    });
    expect(a).toBe(b);
  });

  it("null stock availability fails closed", () => {
    const result = generateQuote(
      baseInput({
        catalog: [catalog(SKU_A, 10000, null)],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe("STOCK_UNAVAILABLE");
  });

  it("empty basket_id fails", () => {
    const result = generateQuote(baseInput({ basket_id: "   " }));
    expect(result.ok).toBe(false);
  });
});
