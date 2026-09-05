-- Phase 2 Step 1 — Mandate persistence model (authorization constraints)
-- Depends on Phase 1 app_user. Does NOT create policy evaluation, shopping intent,
-- Razorpay, or any AI-facing mandate mutation mechanism.
-- Allowed categories are normalized in mandate_category (not a JSON array).

create table if not exists public.mandate (
  mandate_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user (user_id),
  agent_id varchar not null,
  max_spend_minor bigint not null,
  currency varchar(3) not null default 'INR',
  max_per_item_minor bigint null,
  purpose text null,
  valid_until timestamptz not null,
  status text not null default 'CREATED',
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint mandate_agent_id_nonempty check (char_length(trim(agent_id)) > 0),
  constraint mandate_max_spend_minor_non_negative check (max_spend_minor >= 0),
  constraint mandate_max_per_item_minor_non_negative check (
    max_per_item_minor is null or max_per_item_minor >= 0
  ),
  constraint mandate_currency_inr check (currency = 'INR'),
  constraint mandate_status_controlled check (
    status in ('CREATED', 'ACTIVE', 'EXPIRED', 'REVOKED', 'CLOSED')
  ),
  constraint mandate_active_valid_until_after_created check (
    status <> 'ACTIVE' or valid_until > created_at
  )
);

create index if not exists mandate_user_id_idx
  on public.mandate (user_id);

create index if not exists mandate_user_id_status_idx
  on public.mandate (user_id, status);

create index if not exists mandate_status_idx
  on public.mandate (status);

comment on table public.mandate is
  'Phase 2 mandate: user-authorized spend/category bounds for an agent. '
  'Only authorized backend flows may mutate authorization fields. AI has no write access.';

comment on column public.mandate.max_spend_minor is
  'Hard ceiling on final payable in integer INR paise. Never floating point.';

comment on column public.mandate.max_per_item_minor is
  'Optional per-item/line ceiling in integer INR paise. NULL means no per-item limit.';

comment on column public.mandate.currency is
  'Locked MVP currency INR only.';

comment on column public.mandate.valid_until is
  'Mandate expiration (UTC). ACTIVE mandates require valid_until > created_at.';

comment on column public.mandate.status is
  'Lifecycle: CREATED → ACTIVE → EXPIRED | REVOKED | CLOSED. '
  'Policy evaluation is deferred to later Phase 2 steps.';

alter table public.mandate enable row level security;

-- Normalized allow-list categories (Doc 07). Not an FK to catalog category.code —
-- mandate allow-list uses domain labels such as "grocery".
create table if not exists public.mandate_category (
  mandate_id uuid not null references public.mandate (mandate_id) on delete cascade,
  category varchar not null,
  primary key (mandate_id, category),
  constraint mandate_category_nonempty check (char_length(trim(category)) > 0)
);

create index if not exists mandate_category_category_idx
  on public.mandate_category (category);

comment on table public.mandate_category is
  'Normalized mandate allow-list categories. Composite PK (mandate_id, category). '
  'Not stored as a JSON array so authorization queries can join directly.';

comment on column public.mandate_category.category is
  'Allow-list category label (e.g. grocery). Distinct from Phase 1 catalog category.code.';

alter table public.mandate_category enable row level security;

-- Advance operational phase metadata to Phase 2.
insert into public.schema_meta (key, value)
values ('phase', '2')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.schema_meta (key, value)
values (
  'phase2_mandate_schema',
  'mandate + mandate_category; lifecycle CREATED|ACTIVE|EXPIRED|REVOKED|CLOSED; policy deferred'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
