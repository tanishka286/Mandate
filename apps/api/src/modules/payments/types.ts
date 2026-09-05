import type {
  Order,
  OrderState,
  Payment,
  PaymentState,
  CheckoutIdempotencyRecord,
  RazorpayWebhookEventRecord,
  WebhookProcessingStatus,
} from "@mandate/types";

export type {
  Order,
  OrderState,
  Payment,
  PaymentState,
  CheckoutIdempotencyRecord,
  RazorpayWebhookEventRecord,
  WebhookProcessingStatus,
};

/** Database representation for public."order" row. */
export interface OrderRow {
  order_id: string;
  user_id: string;
  session_id: string;
  mandate_id: string;
  basket_id: string;
  policy_decision_id: string;
  status: OrderState;
  gross_amount_minor: number | string;
  discount_amount_minor: number | string;
  final_payable_minor: number | string;
  currency: string;
  razorpay_order_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Database representation for public.payment row. */
export interface PaymentRow {
  payment_id: string;
  order_id: string;
  razorpay_payment_id: string | null;
  status: PaymentState;
  amount_minor: number | string;
  currency: string;
  method: string | null;
  verified_at: string | null;
  failure_code: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Database representation for public.checkout_idempotency row. */
export interface CheckoutIdempotencyRow {
  idempotency_id: string;
  user_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  order_id: string | null;
  response_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Database representation for public.razorpay_webhook_event row. */
export interface RazorpayWebhookEventRow {
  webhook_event_id: string;
  event_id: string;
  event_type: string;
  payload_hash: string | null;
  received_at: string;
  processed_at: string | null;
  processing_status: WebhookProcessingStatus;
  error_code: string | null;
  payload_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Repository insert payload for Order. */
export interface CreateOrderInput {
  order_id?: string;
  user_id: string;
  session_id: string;
  mandate_id: string;
  basket_id: string;
  policy_decision_id: string;
  status?: OrderState;
  gross_amount_minor: number;
  discount_amount_minor: number;
  final_payable_minor: number;
  currency?: "INR";
  razorpay_order_id?: string | null;
}

/** Repository insert payload for Payment. */
export interface CreatePaymentInput {
  payment_id?: string;
  order_id: string;
  razorpay_payment_id?: string | null;
  status?: PaymentState;
  amount_minor: number;
  currency?: "INR";
  method?: string | null;
  verified_at?: string | null;
  failure_code?: string | null;
  metadata_json?: Record<string, unknown>;
}

/** Repository insert payload for Checkout Idempotency. */
export interface CreateCheckoutIdempotencyInput {
  idempotency_id?: string;
  user_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  order_id?: string | null;
  response_json?: Record<string, unknown> | null;
}

/** Repository insert payload for Razorpay Webhook Event. */
export interface CreateRazorpayWebhookEventInput {
  webhook_event_id?: string;
  event_id: string;
  event_type: string;
  payload_hash?: string | null;
  received_at?: string;
  processed_at?: string | null;
  processing_status?: WebhookProcessingStatus;
  error_code?: string | null;
  payload_json?: Record<string, unknown> | null;
}

/** Input for atomic checkout persistence (Phase 8 Step 4A). */
export interface CreateCheckoutPersistenceAtomicInput {
  order_id: string;
  user_id: string;
  session_id: string;
  mandate_id: string;
  basket_id: string;
  policy_decision_id: string;
  gross_amount_minor: number;
  discount_amount_minor: number;
  final_payable_minor: number;
  payment_amount_minor: number;
  idempotency_key: string;
  request_fingerprint: string;
  response_json: Record<string, unknown>;
  razorpay_order_id?: string | null;
  payment_id?: string | null;
  currency?: "INR";
  order_status?: OrderState;
  payment_status?: PaymentState;
}

/** Output of atomic checkout persistence (Phase 8 Step 4A). */
export interface AtomicCheckoutPersistenceResult {
  order: Order;
  payment: Payment;
  idempotency: CheckoutIdempotencyRecord;
  replayed: boolean;
}

/** Request body payload for POST /api/v1/payments/verify. */
export interface VerifyPaymentRequestBody {
  order_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** Service input for payment verification. */
export interface VerifyPaymentInput extends VerifyPaymentRequestBody {
  user_id: string;
}

/** Successful verification result payload (Doc 08). */
export interface VerifyPaymentResult {
  payment_id: string;
  order_id: string;
  status: "VERIFIED";
  razorpay_payment_id: string;
  amount_minor: number;
  verified_at: string;
}

/** Input for atomic payment verification persistence (Phase 8 Step 6). */
export interface VerifyPaymentPersistenceAtomicInput {
  order_id: string;
  payment_id?: string | null;
  razorpay_payment_id: string;
  verified_at?: string | null;
  method?: string | null;
}

/** Output of atomic payment verification persistence (Phase 8 Step 6). */
export interface AtomicPaymentVerificationPersistenceResult {
  order: Order;
  payment: Payment;
  replayed: boolean;
}

