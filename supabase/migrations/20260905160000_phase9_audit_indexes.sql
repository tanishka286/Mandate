-- Phase 9 — Audit query indexes for session-scoped audit trail reads.

create index if not exists audit_event_session_id_idx
  on public.audit_event (session_id);

create index if not exists audit_event_user_id_idx
  on public.audit_event (user_id);

create index if not exists audit_event_session_occurred_at_idx
  on public.audit_event (session_id, occurred_at asc);
