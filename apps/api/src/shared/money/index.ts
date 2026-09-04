/**
 * Money helpers - authoritative financial values use integer minor units.
 * INR: 1 rupee = 100 paise. Never use floating-point for authoritative totals.
 */

export type MoneyMinor = number;

export function assertMoneyMinor(value: number, label = "amount"): MoneyMinor {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer minor-unit amount`);
  }
  if (value < 0) {
    throw new Error(`${label} must be non-negative`);
  }
  return value;
}

export function paiseToDisplayRupees(paise: MoneyMinor): string {
  assertMoneyMinor(paise, "paise");
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  const symbol = "\u20b9";
  return `${symbol}${rupees}.${rem.toString().padStart(2, "0")}`;
}
