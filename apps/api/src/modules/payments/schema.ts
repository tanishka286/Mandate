import { z } from "zod";
import { PAYMENT_STATES } from "./state-machine.js";

export const ORDER_STATES = [
  "CREATED",
  "PAYMENT_PENDING",
  "PAYMENT_VERIFIED",
  "PAYMENT_FAILED",
  "PAYMENT_CANCELLED",
  "PAYMENT_EXPIRED",
] as const;

export const WEBHOOK_PROCESSING_STATES = [
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "FAILED",
  "IGNORED",
] as const;

export const orderStateSchema = z.enum(ORDER_STATES);

export const paymentStateSchema = z.enum(PAYMENT_STATES);

export const webhookProcessingStatusSchema = z.enum(WEBHOOK_PROCESSING_STATES);

export const createOrderInputSchema = z
  .object({
    order_id: z.string().uuid().optional(),
    user_id: z.string().uuid(),
    session_id: z.string().uuid(),
    mandate_id: z.string().uuid(),
    basket_id: z.string().uuid(),
    policy_decision_id: z.string().uuid(),
    status: orderStateSchema.optional().default("CREATED"),
    gross_amount_minor: z.number().int().nonnegative(),
    discount_amount_minor: z.number().int().nonnegative().default(0),
    final_payable_minor: z.number().int().nonnegative(),
    currency: z.literal("INR").optional().default("INR"),
    razorpay_order_id: z.string().trim().min(1).nullable().optional(),
  })
  .refine(
    (val) => val.discount_amount_minor <= val.gross_amount_minor,
    {
      message: "discount_amount_minor cannot exceed gross_amount_minor",
      path: ["discount_amount_minor"],
    },
  );

export const createPaymentInputSchema = z.object({
  payment_id: z.string().uuid().optional(),
  order_id: z.string().uuid(),
  razorpay_payment_id: z.string().trim().min(1).nullable().optional(),
  status: paymentStateSchema.optional().default("PAYMENT_PENDING"),
  amount_minor: z.number().int().nonnegative(),
  currency: z.literal("INR").optional().default("INR"),
  method: z.string().trim().min(1).nullable().optional(),
  verified_at: z.string().datetime().nullable().optional(),
  failure_code: z.string().trim().min(1).nullable().optional(),
  metadata_json: z.record(z.unknown()).optional().default({}),
});

export const createCheckoutIdempotencyInputSchema = z.object({
  idempotency_id: z.string().uuid().optional(),
  user_id: z.string().uuid(),
  idempotency_key: z.string().trim().min(1),
  request_fingerprint: z.string().trim().min(1),
  order_id: z.string().uuid().nullable().optional(),
  response_json: z.record(z.unknown()).nullable().optional(),
});

export const createRazorpayWebhookEventInputSchema = z.object({
  webhook_event_id: z.string().uuid().optional(),
  event_id: z.string().trim().min(1),
  event_type: z.string().trim().min(1),
  payload_hash: z.string().trim().min(1).nullable().optional(),
  received_at: z.string().datetime().optional(),
  processed_at: z.string().datetime().nullable().optional(),
  processing_status: webhookProcessingStatusSchema.optional().default("RECEIVED"),
  error_code: z.string().trim().min(1).nullable().optional(),
  payload_json: z.record(z.unknown()).nullable().optional(),
});
