-- Phase 10 Step 1 — Authoritative incentive persistence (Doc 07 / Doc 10 §4.2).
-- Depends on Phase 7 optimization_run and basket for evaluation FK targets.
-- Does NOT implement external loyalty APIs, Razorpay, or AI mutation paths.

create table if not exists public.incentive (
  incentive_id uuid primary key,
  type text not null,
  name text not null,
  description text null,
  status text not null,
  valid_from timestamptz null,
  valid_until timestamptz null,
  rules_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint incentive_type_controlled check (
    type in ('VOUCHER', 'LOYALTY_REWARD')
  ),
  constraint incentive_status_controlled check (
    status in ('ACTIVE', 'INACTIVE', 'EXPIRED')
  ),
  constraint incentive_name_nonempty check (char_length(trim(name)) > 0)
);

create index if not exists incentive_status_idx
  on public.incentive (status);

create index if not exists incentive_type_idx
  on public.incentive (type);

comment on table public.incentive is
  'Phase 10 authoritative merchant incentive facts (vouchers, loyalty rewards). '
  'rules_json is server-side only — AI cannot invent eligibility or savings.';

comment on column public.incentive.rules_json is
  'Authoritative benefit rules (threshold, discount, min spend, future value).';

-- ---------------------------------------------------------------------------
-- incentive_evaluation — persisted optimization decisions (Doc 07)
-- ---------------------------------------------------------------------------
create table if not exists public.incentive_evaluation (
  evaluation_id uuid primary key default gen_random_uuid(),
  optimization_run_id uuid not null
    references public.optimization_run (optimization_run_id),
  basket_id uuid null references public.basket (basket_id),
  incentive_id uuid not null references public.incentive (incentive_id),
  decision text not null,
  current_saving_minor bigint not null,
  future_value_minor bigint null,
  reason text null,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default (timezone('utc', now())),
  constraint incentive_evaluation_decision_controlled check (
    decision in ('USE_NOW', 'SAVE_FOR_LATER', 'DO_NOT_USE')
  ),
  constraint incentive_evaluation_current_saving_non_negative check (
    current_saving_minor >= 0
  ),
  constraint incentive_evaluation_future_value_non_negative check (
    future_value_minor is null or future_value_minor >= 0
  )
);

create index if not exists incentive_evaluation_run_id_idx
  on public.incentive_evaluation (optimization_run_id);

create index if not exists incentive_evaluation_incentive_id_idx
  on public.incentive_evaluation (incentive_id);

comment on table public.incentive_evaluation is
  'Persisted USE_NOW / SAVE_FOR_LATER / DO_NOT_USE decisions with eligibility snapshot.';

alter table public.incentive enable row level security;
alter table public.incentive_evaluation enable row level security;
