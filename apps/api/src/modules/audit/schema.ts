import { z } from "zod";
import {
  PAYMENT_VERIFICATION_AUDIT_EVENT_TYPES,
  WEBHOOK_AUDIT_EVENT_TYPES,
} from "./types.js";

export const paymentVerificationAuditEventTypeSchema = z.enum(
  PAYMENT_VERIFICATION_AUDIT_EVENT_TYPES,
);

export const webhookAuditEventTypeSchema = z.enum(WEBHOOK_AUDIT_EVENT_TYPES);

export const auditEventTypeSchema = z.union([
  paymentVerificationAuditEventTypeSchema,
  webhookAuditEventTypeSchema,
]);

export const recordAuditEventInputSchema = z.object({
  event_type: auditEventTypeSchema,
  user_id: z.string().uuid().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  mandate_id: z.string().uuid().nullable().optional(),
  basket_id: z.string().uuid().nullable().optional(),
  policy_decision_id: z.string().uuid().nullable().optional(),
  order_id: z.string().uuid().nullable().optional(),
  payment_id: z.string().uuid().nullable().optional(),
  event_data_json: z.record(z.unknown()),
  occurred_at: z.string().datetime().optional(),
});
