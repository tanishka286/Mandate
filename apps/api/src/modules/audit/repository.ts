import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type { AuditEvent, AuditEventRow, RecordAuditEventInput } from "./types.js";

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

/**
 * Audit repository — minimal write path for Step 6 payment verification events.
 */
export class AuditRepository {
  async createEvent(input: RecordAuditEventInput): Promise<AuditEvent> {
    const db = getSupabaseClient();
    const occurredAt = input.occurred_at ?? new Date().toISOString();

    const payload: Record<string, unknown> = {
      event_type: input.event_type,
      user_id: input.user_id ?? null,
      session_id: input.session_id ?? null,
      mandate_id: input.mandate_id ?? null,
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
}
