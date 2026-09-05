import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type {
  AuditEvent,
  AuditEventRow,
  RecordAuditEventInput,
  SessionAuditEventView,
} from "./types.js";

function mapAuditEventRow(row: AuditEventRow): AuditEvent {
  return {
    audit_event_id: row.audit_event_id,
    event_type: row.event_type,
    user_id: row.user_id,
    session_id: row.session_id,
    agent_run_id: row.agent_run_id,
    mandate_id: row.mandate_id,
    optimization_run_id: row.optimization_run_id,
    basket_id: row.basket_id,
    policy_decision_id: row.policy_decision_id,
    order_id: row.order_id,
    payment_id: row.payment_id,
    event_data_json: row.event_data_json ?? {},
    occurred_at: row.occurred_at,
    created_at: row.created_at,
  };
}

function toSessionAuditEventView(row: AuditEventRow): SessionAuditEventView {
  return {
    audit_event_id: row.audit_event_id,
    event_type: row.event_type,
    occurred_at: row.occurred_at,
    user_id: row.user_id,
    session_id: row.session_id,
    agent_run_id: row.agent_run_id,
    mandate_id: row.mandate_id,
    optimization_run_id: row.optimization_run_id,
    basket_id: row.basket_id,
    policy_decision_id: row.policy_decision_id,
    order_id: row.order_id,
    payment_id: row.payment_id,
    event_data: row.event_data_json ?? {},
  };
}

/**
 * Audit repository — append-only write path and session-scoped reads.
 */
export class AuditRepository {
  async createEvent(input: RecordAuditEventInput): Promise<AuditEvent> {
    const db = getSupabaseClient();
    const occurredAt = input.occurred_at ?? new Date().toISOString();

    const payload: Record<string, unknown> = {
      event_type: input.event_type,
      user_id: input.user_id ?? null,
      session_id: input.session_id ?? null,
      agent_run_id: input.agent_run_id ?? null,
      mandate_id: input.mandate_id ?? null,
      optimization_run_id: input.optimization_run_id ?? null,
      basket_id: input.basket_id ?? null,
      policy_decision_id: input.policy_decision_id ?? null,
      order_id: input.order_id ?? null,
      payment_id: input.payment_id ?? null,
      event_data_json: input.event_data_json,
      occurred_at: occurredAt,
    };

    const { data, error } = await db
      .from("audit_event")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert audit event");
    }

    return mapAuditEventRow(data as AuditEventRow);
  }

  /**
   * List audit events for a session in chronological order.
   * Caller must enforce session ownership before invoking.
   */
  async listBySessionId(sessionId: string): Promise<SessionAuditEventView[]> {
    const db = getSupabaseClient();

    const { data, error } = await db
      .from("audit_event")
      .select("*")
      .eq("session_id", sessionId)
      .order("occurred_at", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to list audit events for session");
    }

    return (data as AuditEventRow[]).map(toSessionAuditEventView);
  }
}
