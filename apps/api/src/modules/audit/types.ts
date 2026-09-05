/** Doc 07 §19 — payment verification audit events (Doc 09 §24.1). */
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

/** Phase 9 — commerce workflow audit events. */
export const WORKFLOW_AUDIT_EVENT_TYPES = [
  "INTENT_RECEIVED",
  "REQUIREMENTS_CREATED",
  "PRODUCT_RESEARCHED",
  "BASKET_CREATED",
  "VOUCHER_EVALUATED",
  "LOYALTY_EVALUATED",
  "BASKET_RECOMMENDED",
  "BASKET_SELECTED",
  "FRESH_QUOTE",
  "POLICY_ALLOW",
  "POLICY_DENY",
  "RAZORPAY_ORDER_CREATED",
  "ORDER_CONFIRMED",
] as const;

export type WorkflowAuditEventType =
  (typeof WORKFLOW_AUDIT_EVENT_TYPES)[number];

export const AUDIT_EVENT_TYPES = [
  ...WORKFLOW_AUDIT_EVENT_TYPES,
  ...PAYMENT_VERIFICATION_AUDIT_EVENT_TYPES,
  ...WEBHOOK_AUDIT_EVENT_TYPES,
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Correlation context shared across workflow audit events. */
export interface WorkflowAuditContext {
  user_id?: string | null;
  session_id?: string | null;
  agent_run_id?: string | null;
  mandate_id?: string | null;
  optimization_run_id?: string | null;
  basket_id?: string | null;
  policy_decision_id?: string | null;
  order_id?: string | null;
  payment_id?: string | null;
  request_id?: string | null;
}

/** Correlation context shared across payment verification audit events. */
export interface PaymentVerificationAuditContext extends WorkflowAuditContext {
  user_id: string;
  session_id: string;
  mandate_id: string;
  basket_id: string;
  policy_decision_id: string;
  order_id: string;
  payment_id: string;
}

/** Correlation context for webhook audit events. */
export interface WebhookAuditContext extends WorkflowAuditContext {
  event_id: string;
  event_type: string;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
}

export type AuditCorrelationContext =
  | WorkflowAuditContext
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
  agent_run_id?: string | null;
  mandate_id?: string | null;
  optimization_run_id?: string | null;
  basket_id?: string | null;
  policy_decision_id?: string | null;
  order_id?: string | null;
  payment_id?: string | null;
  event_data_json: Record<string, unknown>;
  occurred_at?: string;
}

/** API response shape for session audit trail. */
export interface SessionAuditEventView {
  audit_event_id: string;
  event_type: string;
  occurred_at: string;
  user_id: string | null;
  session_id: string | null;
  agent_run_id: string | null;
  mandate_id: string | null;
  optimization_run_id: string | null;
  basket_id: string | null;
  policy_decision_id: string | null;
  order_id: string | null;
  payment_id: string | null;
  event_data: Record<string, unknown>;
}

export interface SessionAuditTrailData {
  session_id: string;
  events: SessionAuditEventView[];
}
