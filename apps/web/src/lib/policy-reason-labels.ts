/** Presentation labels for authoritative policy reason codes from the backend. */
const POLICY_REASON_LABELS: Record<string, string> = {
  MAX_SPEND_EXCEEDED: "MAX_SPEND_EXCEEDED",
  CATEGORY_NOT_ALLOWED: "CATEGORY_NOT_ALLOWED",
  STOCK_UNAVAILABLE: "STOCK_UNAVAILABLE",
  MAX_PER_ITEM_EXCEEDED: "MAX_PER_ITEM_EXCEEDED",
  INCENTIVE_INVALID: "INCENTIVE_INVALID",
  MANDATE_INVALID: "MANDATE_INVALID",
  AMOUNT_CALCULATION_FAILED: "AMOUNT_CALCULATION_FAILED",
};

export function policyReasonLabel(code: string): string {
  return POLICY_REASON_LABELS[code] ?? code;
}
