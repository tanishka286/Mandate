import { z } from "zod";
import {
  AUDIT_EVENT_TYPES,
  PAYMENT_VERIFICATION_AUDIT_EVENT_TYPES,
  WEBHOOK_AUDIT_EVENT_TYPES,
  WORKFLOW_AUDIT_EVENT_TYPES,
} from "./types.js";

export const workflowAuditEventTypeSchema = z.enum(WORKFLOW_AUDIT_EVENT_TYPES);

export const paymentVerificationAuditEventTypeSchema = z.enum(
  PAYMENT_VERIFICATION_AUDIT_EVENT_TYPES,
);

export const webhookAuditEventTypeSchema = z.enum(WEBHOOK_AUDIT_EVENT_TYPES);

export const auditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);

export const recordAuditEventInputSchema = z.object({
  event_type: auditEventTypeSchema,
  user_id: z.string().uuid().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  agent_run_id: z.string().uuid().nullable().optional(),
  mandate_id: z.string().uuid().nullable().optional(),
  optimization_run_id: z.string().uuid().nullable().optional(),
  basket_id: z.string().uuid().nullable().optional(),
  policy_decision_id: z.string().uuid().nullable().optional(),
  order_id: z.string().uuid().nullable().optional(),
  payment_id: z.string().uuid().nullable().optional(),
  event_data_json: z.record(z.unknown()),
  occurred_at: z.string().datetime().optional(),
});

export const sessionIdAuditParamsSchema = z.object({
  session_id: z.string().uuid(),
});

export const sessionAuditEventViewSchema = z.object({
  audit_event_id: z.string().uuid(),
  event_type: z.string(),
  occurred_at: z.string(),
  user_id: z.string().uuid().nullable(),
  session_id: z.string().uuid().nullable(),
  agent_run_id: z.string().uuid().nullable(),
  mandate_id: z.string().uuid().nullable(),
  optimization_run_id: z.string().uuid().nullable(),
  basket_id: z.string().uuid().nullable(),
  policy_decision_id: z.string().uuid().nullable(),
  order_id: z.string().uuid().nullable(),
  payment_id: z.string().uuid().nullable(),
  event_data: z.record(z.unknown()),
});

export const sessionAuditTrailDataSchema = z.object({
  session_id: z.string().uuid(),
  events: z.array(sessionAuditEventViewSchema),
});
