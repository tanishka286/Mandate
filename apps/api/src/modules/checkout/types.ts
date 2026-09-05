import type { CheckoutResult } from "@mandate/types";

export type { CheckoutResult };

/**
 * Authoritative input to the internal CheckoutService.
 *
 * NOTE:
 * - Client NEVER provides amount, gross_amount, discount_amount, final_payable_minor,
 *   currency, razorpay_order_id, payment status, or mandate changes.
 * - All financial values are derived exclusively from authoritative fresh quote + policy revalidation.
 */
export interface CheckoutInput {
  user_id: string;
  session_id?: string;
  selection_id: string;
  policy_decision_id: string;
  idempotency_key: string;
  request_id?: string;
}

/**
 * Sanitized HTTP response payload for POST /api/v1/checkout.
 * Exposes only public handoff details; never leaks secrets or internal fingerprints.
 */
export interface CheckoutResponseData {
  order_id: string;
  razorpay_order_id: string;
  amount_minor: number;
  currency: string;
  status: "PAYMENT_PENDING";
  razorpay_key_id?: string;
}
