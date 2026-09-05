-- Phase 3 Step 3 — Requirement persistence foundation
-- Depends on Phase 3 Step 2 shopping_intent.
-- Does NOT implement requirement extraction, catalog binding, optimization, or HTTP extract routes.
-- A requirement represents WHAT the user needs — not product, SKU, price, stock, or payment.

create table if not exists public.requirement (
  requirement_id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.shopping_intent (intent_id),
  item_name varchar not null,
  target_quantity numeric not null,
  unit varchar not null,
  minimum_quality varchar null,
  constraints_json jsonb not null default '[]'::jsonb,
  confidence numeric null,
  status text not null default 'CREATED',
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint requirement_item_name_nonempty check (
    char_length(trim(item_name)) > 0
  ),
  constraint requirement_target_quantity_positive check (
    target_quantity > 0
  ),
  constraint requirement_unit_nonempty check (
    char_length(trim(unit)) > 0
  ),
  constraint requirement_minimum_quality_nonempty check (
    minimum_quality is null
    or char_length(trim(minimum_quality)) > 0
  ),
  constraint requirement_confidence_range check (
    confidence is null
    or (confidence >= 0 and confidence <= 1)
  ),
  constraint requirement_status_controlled check (
    status in ('CREATED')
  )
);

create index if not exists requirement_intent_id_idx
  on public.requirement (intent_id);

create index if not exists requirement_intent_id_status_idx
  on public.requirement (intent_id, status);

comment on table public.requirement is
  'Phase 3 requirement: what the user needs for a shopping intent (Doc 07 §9.2). '
  'Not a product/SKU/price/stock/basket/policy/payment record. '
  'Extraction service/API is deferred to a later Phase 3 step.';

comment on column public.requirement.item_name is
  'Grocery item/ingredient needed (e.g. eggs, pasta). Not a product_id or sku_id.';

comment on column public.requirement.target_quantity is
  'Required quantity before pack/SKU selection (NUMERIC/DECIMAL). Must be positive.';

comment on column public.requirement.unit is
  'Unit for target_quantity (e.g. pieces, packs). Nonempty; no silent unit conversion.';

comment on column public.requirement.minimum_quality is
  'Optional minimum quality label when quality is material. Not a scoring system.';

comment on column public.requirement.constraints_json is
  'Structured constraints (default empty JSON array). Not catalog/price/stock/policy authority.';

comment on column public.requirement.confidence is
  'Optional extraction confidence in [0, 1]. Interpretation metadata — not authorization.';

comment on column public.requirement.status is
  'Controlled lifecycle. CREATED only in Phase 3 Step 3 — Doc 07 requires status ENUM; '
  'locked docs do not define further requirement states (no catalog/optimization states).';

-- Backend (service role) remains the authorization boundary.
-- Ownership flows: app_user → shopping_session → shopping_intent → requirement
-- (same RLS-enabled, no-policy pattern as Phase 3 session/intent tables).
alter table public.requirement enable row level security;

-- Keep operational phase at Phase 3; record Step 3 schema lock.
insert into public.schema_meta (key, value)
values ('phase', '3')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.schema_meta (key, value)
values (
  'phase3_requirement_schema',
  'requirement; lifecycle CREATED; extraction deferred'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
