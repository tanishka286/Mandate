/**
 * Doc 06 policy denial reason codes — exact locked vocabulary.
 */
export const POLICY_REASON_CODES = [
  "MANDATE_INVALID",
  "CATEGORY_NOT_ALLOWED",
  "STOCK_UNAVAILABLE",
  "MAX_PER_ITEM_EXCEEDED",
  "INCENTIVE_INVALID",
  "AMOUNT_CALCULATION_FAILED",
  "MAX_SPEND_EXCEEDED",
] as const;

export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

/** Locked policy version recorded on every decision. */
export const POLICY_VERSION = "policy-v1" as const;
