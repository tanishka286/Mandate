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
  session_id: string;
  selection_id: string;
  policy_decision_id: string;
  idempotency_key: string;
  request_id?: string;
}
