/**
 * Phase 1 Step 8 — authoritative cart pricing (pure functions).
 * Money is integer minor units (paise). No floating-point arithmetic.
 * discount_amount_minor is always 0 in this phase (no incentive engine).
 */

import { assertMoneyMinor, type MoneyMinor } from "../../shared/money/index.js";

export const CART_PRICING_CURRENCY = "INR" as const;

export type CartPricingCurrency = typeof CART_PRICING_CURRENCY;

export interface CartPricingLineInput {
  quantity: number;
  price_minor: number;
  currency: string;
}

export interface CartPricedLineAmounts {
  unit_price_minor: MoneyMinor;
  line_amount_minor: MoneyMinor;
  currency: CartPricingCurrency;
}

export interface CartPricingTotals {
  lines: CartPricedLineAmounts[];
  gross_amount_minor: MoneyMinor;
  discount_amount_minor: MoneyMinor;
  final_payable_minor: MoneyMinor;
  currency: CartPricingCurrency;
}

/**
 * line_amount_minor = quantity × sku.price_minor (integer arithmetic only).
 */
export function calculateLineAmountMinor(
  quantity: number,
  priceMinor: number,
): MoneyMinor {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("quantity must be an integer >= 1");
  }
  const unit = assertMoneyMinor(priceMinor, "unit_price_minor");

  // Prefer BigInt so large values never lose precision via float multiplication.
  const product = BigInt(unit) * BigInt(quantity);
  if (product > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("line_amount_minor exceeds safe integer range");
  }
  return assertMoneyMinor(Number(product), "line_amount_minor");
}

/**
 * gross = SUM(line amounts); discount = 0; final_payable = gross - discount.
 * final_payable is never negative. Mixed/non-INR currency fails safely.
 */
export function calculateCartPricing(
  lines: CartPricingLineInput[],
): CartPricingTotals {
  if (lines.length === 0) {
    return {
      lines: [],
      gross_amount_minor: 0,
      discount_amount_minor: 0,
      final_payable_minor: 0,
      currency: CART_PRICING_CURRENCY,
    };
  }

  const pricedLines: CartPricedLineAmounts[] = [];
  let gross = 0n;

  for (const line of lines) {
    if (line.currency !== CART_PRICING_CURRENCY) {
      throw new Error(
        `Unsupported currency for cart pricing: ${line.currency}`,
      );
    }

    const unit_price_minor = assertMoneyMinor(
      line.price_minor,
      "unit_price_minor",
    );
    const line_amount_minor = calculateLineAmountMinor(
      line.quantity,
      unit_price_minor,
    );

    pricedLines.push({
      unit_price_minor,
      line_amount_minor,
      currency: CART_PRICING_CURRENCY,
    });
    gross += BigInt(line_amount_minor);
  }

  if (gross > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("gross_amount_minor exceeds safe integer range");
  }

  const gross_amount_minor = assertMoneyMinor(
    Number(gross),
    "gross_amount_minor",
  );
  const discount_amount_minor = 0;
  const final_payable_minor = assertMoneyMinor(
    gross_amount_minor - discount_amount_minor,
    "final_payable_minor",
  );

  return {
    lines: pricedLines,
    gross_amount_minor,
    discount_amount_minor,
    final_payable_minor,
    currency: CART_PRICING_CURRENCY,
  };
}
