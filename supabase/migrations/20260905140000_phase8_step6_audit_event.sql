-- Phase 8 Step 6 — Audit event foundation (Doc 07 §19.1)
-- Minimal audit_event table for payment verification audit events.
-- Broader Phase 9 audit coverage is out of scope.

create table if not exists public.audit_event (
  audit_event_id uuid primary key default gen_random_uuid(),
  event_type varchar not null,
  user_id uuid null references public.app_user (user_id),
  session_id uuid null references public.shopping_session (session_id),
  agent_run_id uuid null,
  mandate_id uuid null references public.mandate (mandate_id),
  optimization_run_id uuid null references public.optimization_run (optimization_run_id),
  basket_id uuid null references public.basket (basket_id),
  policy_decision_id uuid null references public.policy_decision (policy_decision_id),
  order_id uuid null references public."order" (order_id),
  payment_id uuid null references public.payment (payment_id),
  event_data_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default (timezone('utc', now())),
  constraint audit_event_type_nonempty check (char_length(trim(event_type)) > 0)
);

create index if not exists audit_event_event_type_idx
  on public.audit_event (event_type);

create index if not exists audit_event_order_id_idx
  on public.audit_event (order_id);

create index if not exists audit_event_payment_id_idx
  on public.audit_event (payment_id);

create index if not exists audit_event_occurred_at_idx
  on public.audit_event (occurred_at desc);

alter table public.audit_event enable row level security;
