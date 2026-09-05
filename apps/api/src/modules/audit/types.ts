/** Doc 07 §19.1 — payment verification audit events (Doc 09 §24.1). */
export const PAYMENT_VERIFICATION_AUDIT_EVENT_TYPES = [
  "PAYMENT_VERIFY_REQUESTED",
  "PAYMENT_VERIFIED",
  "PAYMENT_FAILED",
  "AMOUNT_MISMATCH",
] as const;

export type PaymentVerificationAuditEventType =
  (typeof PAYMENT_VERIFICATION_AUDIT_EVENT_TYPES)[number];

/** Doc 09 — Razorpay webhook audit events. */
export const WEBHOOK_AUDIT_EVENT_TYPES = [
  "WEBHOOK_RECEIVED",
  "WEBHOOK_PROCESSED",
] as const;

export type WebhookAuditEventType =
  (typeof WEBHOOK_AUDIT_EVENT_TYPES)[number];

export type AuditEventType =
  | PaymentVerificationAuditEventType
  | WebhookAuditEventType;

/** Correlation context shared across payment verification audit events. */
export interface PaymentVerificationAuditContext {
  user_id: string;
  session_id: string;
  mandate_id: string;
  basket_id: string;
  policy_decision_id: string;
  order_id: string;
  payment_id: string;
  request_id?: string | null;
}

/** Correlation context for webhook audit events. */
export interface WebhookAuditContext {
  event_id: string;
  event_type: string;
  request_id?: string | null;
  user_id?: string | null;
  session_id?: string | null;
  mandate_id?: string | null;
  basket_id?: string | null;
  policy_decision_id?: string | null;
  order_id?: string | null;
  payment_id?: string | null;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
}

export type AuditCorrelationContext =
  | PaymentVerificationAuditContext
  | WebhookAuditContext;

/** Database representation for public.audit_event row. */
export interface AuditEventRow {
  audit_event_id: string;
  event_type: string;
  user_id: string | null;
  session_id: string | null;
  agent_run_id: string | null;
  mandate_id: string | null;
  optimization_run_id: string | null;
  basket_id: string | null;
  policy_decision_id: string | null;
  order_id: string | null;
  payment_id: string | null;
  event_data_json: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export type AuditEvent = AuditEventRow;

export interface RecordAuditEventInput {
  event_type: AuditEventType;
  user_id?: string | null;
  session_id?: string | null;
  mandate_id?: string | null;
  basket_id?: string | null;
  policy_decision_id?: string | null;
  order_id?: string | null;
  payment_id?: string | null;
  event_data_json: Record<string, unknown>;
  occurred_at?: string;
}
