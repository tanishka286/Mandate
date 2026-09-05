-- Phase 2 Step 3 — Policy decision persistence model (historical authorization facts)
-- Depends on Phase 2 Step 1 mandate table.
--
-- basket_id: UUID NOT NULL, FK intentionally deferred.
-- Doc 07 requires a real public.basket (optimization phase). Do NOT create a stub
-- basket table and do NOT map basket_id to cart. FK to basket will be added later
-- when the real basket entity exists.
--
-- Does NOT implement the policy evaluation engine, POST /policy/evaluate, or AI mutation.

create table if not exists public.policy_decision (
  policy_decision_id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references public.mandate (mandate_id),
  basket_id uuid not null,
  decision text not null,
  reason_code varchar null,
  gross_amount_minor bigint not null,
  discount_amount_minor bigint not null,
  final_payable_minor bigint not null,
  max_spend_minor bigint not null,
  policy_version varchar not null,
  evaluated_at timestamptz not null,
  request_id varchar not null,
  created_at timestamptz not null default (timezone('utc', now())),
  constraint policy_decision_decision_controlled check (
    decision in ('ALLOW', 'DENY')
  ),
  constraint policy_decision_deny_reason_required check (
    decision <> 'DENY'
    or (
      reason_code is not null
      and char_length(trim(reason_code)) > 0
    )
  ),
  constraint policy_decision_gross_amount_minor_non_negative check (
    gross_amount_minor >= 0
  ),
  constraint policy_decision_discount_amount_minor_non_negative check (
    discount_amount_minor >= 0
  ),
  constraint policy_decision_final_payable_minor_non_negative check (
    final_payable_minor >= 0
  ),
  constraint policy_decision_max_spend_minor_non_negative check (
    max_spend_minor >= 0
  ),
  constraint policy_decision_discount_not_exceed_gross check (
    discount_amount_minor <= gross_amount_minor
  ),
  constraint policy_decision_policy_version_nonempty check (
    char_length(trim(policy_version)) > 0
  ),
  constraint policy_decision_request_id_nonempty check (
    char_length(trim(request_id)) > 0
  )
);

create index if not exists policy_decision_mandate_id_idx
  on public.policy_decision (mandate_id);

create index if not exists policy_decision_basket_id_idx
  on public.policy_decision (basket_id);

create index if not exists policy_decision_evaluated_at_idx
  on public.policy_decision (evaluated_at);

comment on table public.policy_decision is
  'Phase 2 Step 3 immutable historical authorization fact (ALLOW|DENY). '
  'Written only by authorized backend flows. AI cannot determine or mutate decisions. '
  'Policy evaluation engine is deferred to a later Phase 2 step.';

comment on column public.policy_decision.basket_id is
  'References the future Doc 07 basket entity. UUID NOT NULL; FK deferred until '
  'public.basket exists in the optimization phase. Not a cart_id.';

comment on column public.policy_decision.decision is
  'ALLOW or DENY. DENY requires a nonempty reason_code.';

comment on column public.policy_decision.final_payable_minor is
  'Authoritative final payable snapshot in integer INR paise at evaluation time.';

comment on column public.policy_decision.policy_version is
  'Required policy version identifier for audit/replay correlation.';

comment on column public.policy_decision.request_id is
  'Request correlation id for the evaluation that produced this decision.';

comment on column public.policy_decision.evaluated_at is
  'UTC timestamp when the server evaluated the decision.';

-- Backend (service role) remains the authorization boundary.
alter table public.policy_decision enable row level security;

-- Keep operational phase metadata at Phase 2; record Step 3 schema lock.
insert into public.schema_meta (key, value)
values ('phase', '2')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.schema_meta (key, value)
values (
  'phase2_policy_decision_schema',
  'policy_decision; basket_id UUID NOT NULL (FK deferred); ALLOW|DENY; engine deferred'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
