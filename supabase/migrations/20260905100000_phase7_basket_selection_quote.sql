-- Phase 7 — User Selection & Fresh Quote (Doc 07 §§12–15 / Doc 08 §§12–13)
-- Persists optimization_run (minimal FK target), basket, basket_item,
-- basket_selection, and basket_quote. Does NOT create orders, payments,
-- or Razorpay state. Selection remains preference-only; quote is authoritative
-- for later policy evaluation (Phase 8 owns payment).

-- ---------------------------------------------------------------------------
-- optimization_run (minimal for basket FK; full optimization HTTP deferred)
-- ---------------------------------------------------------------------------
create table if not exists public.optimization_run (
  optimization_run_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.shopping_session (session_id),
  intent_id uuid null references public.shopping_intent (intent_id),
  mandate_id uuid null references public.mandate (mandate_id),
  status text not null default 'COMPLETED',
  candidate_count integer not null default 0,
  recommendation_json jsonb null,
  started_at timestamptz not null default (timezone('utc', now())),
  completed_at timestamptz null,
  created_at timestamptz not null default (timezone('utc', now())),
  constraint optimization_run_status_controlled check (
    status in ('RUNNING', 'COMPLETED', 'FAILED')
  ),
  constraint optimization_run_candidate_count_non_negative check (
    candidate_count >= 0
  )
);

create index if not exists optimization_run_session_id_idx
  on public.optimization_run (session_id);

create index if not exists optimization_run_session_id_created_at_idx
  on public.optimization_run (session_id, created_at desc);

comment on table public.optimization_run is
  'Phase 7 minimal optimization run row so baskets can reference a workflow run. '
  'Full optimization HTTP/persistence expansion is not required for selection/quote.';

-- ---------------------------------------------------------------------------
-- basket (Doc 07 §13.1)
-- ---------------------------------------------------------------------------
create table if not exists public.basket (
  basket_id uuid primary key default gen_random_uuid(),
  optimization_run_id uuid not null
    references public.optimization_run (optimization_run_id),
  session_id uuid not null references public.shopping_session (session_id),
  user_id uuid not null references public.app_user (user_id),
  basket_type text not null,
  status text not null default 'CURRENT',
  -- Planning snapshots only — NEVER authoritative for payment (fresh quote wins).
  gross_amount_minor bigint not null default 0,
  discount_amount_minor bigint not null default 0,
  final_payable_minor bigint not null default 0,
  currency varchar(3) not null default 'INR',
  quality_summary text null,
  recommendation_reason text null,
  explanation text null,
  combination_key text null,
  -- Bumped when material basket lines change → invalidates prior quotes.
  state_version integer not null default 1,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint basket_type_controlled check (
    basket_type in ('BEST_VALUE', 'BEST_QUALITY')
  ),
  constraint basket_status_controlled check (
    status in ('CURRENT', 'SUPERSEDED')
  ),
  constraint basket_gross_amount_minor_non_negative check (
    gross_amount_minor >= 0
  ),
  constraint basket_discount_amount_minor_non_negative check (
    discount_amount_minor >= 0
  ),
  constraint basket_final_payable_minor_non_negative check (
    final_payable_minor >= 0
  ),
  constraint basket_discount_not_exceed_gross check (
    discount_amount_minor <= gross_amount_minor
  ),
  constraint basket_currency_inr check (currency = 'INR'),
  constraint basket_state_version_positive check (state_version >= 1)
);

create index if not exists basket_session_id_idx
  on public.basket (session_id);

create index if not exists basket_user_id_idx
  on public.basket (user_id);

create index if not exists basket_optimization_run_id_idx
  on public.basket (optimization_run_id);

create index if not exists basket_session_status_idx
  on public.basket (session_id, status);

-- At most one CURRENT basket per type within an optimization run.
create unique index if not exists basket_run_type_current_uidx
  on public.basket (optimization_run_id, basket_type)
  where status = 'CURRENT';

comment on table public.basket is
  'Phase 7 Doc 07 basket. BEST_VALUE / BEST_QUALITY proposals from optimization. '
  'Amounts are planning snapshots; payment path must use a fresh basket_quote.';

comment on column public.basket.state_version is
  'Incremented on material basket line changes. Quotes store the version they '
  'were calculated against for stale-state detection.';

-- ---------------------------------------------------------------------------
-- basket_item (Doc 07 §13.2)
-- ---------------------------------------------------------------------------
create table if not exists public.basket_item (
  basket_item_id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.basket (basket_id) on delete cascade,
  requirement_id uuid null references public.requirement (requirement_id),
  sku_id uuid not null references public.sku (sku_id),
  quantity integer not null,
  -- Snapshot fields for audit/explanation only (not payment authority).
  unit_price_minor bigint not null default 0,
  line_amount_minor bigint not null default 0,
  quality_level varchar null,
  evidence_refs_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint basket_item_quantity_positive check (quantity >= 1),
  constraint basket_item_unit_price_minor_non_negative check (
    unit_price_minor >= 0
  ),
  constraint basket_item_line_amount_minor_non_negative check (
    line_amount_minor >= 0
  )
);

create index if not exists basket_item_basket_id_idx
  on public.basket_item (basket_id);

create index if not exists basket_item_sku_id_idx
  on public.basket_item (sku_id);

comment on table public.basket_item is
  'Phase 7 basket lines. Snapshot prices are non-authoritative; fresh quote '
  're-reads sku.price_minor and stock before policy.';

-- ---------------------------------------------------------------------------
-- basket_selection (Doc 07 §15.1)
-- ---------------------------------------------------------------------------
create table if not exists public.basket_selection (
  selection_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.shopping_session (session_id),
  basket_id uuid not null references public.basket (basket_id),
  user_id uuid not null references public.app_user (user_id),
  selection_source text not null,
  selected_at timestamptz not null default (timezone('utc', now())),
  superseded_at timestamptz null,
  created_at timestamptz not null default (timezone('utc', now())),
  constraint basket_selection_source_controlled check (
    selection_source in ('USER')
  ),
  constraint basket_selection_superseded_consistency check (
    superseded_at is null
    or superseded_at >= selected_at
  )
);

create index if not exists basket_selection_session_id_idx
  on public.basket_selection (session_id);

create index if not exists basket_selection_basket_id_idx
  on public.basket_selection (basket_id);

-- At most one active (non-superseded) selection per session.
create unique index if not exists basket_selection_session_active_uidx
  on public.basket_selection (session_id)
  where superseded_at is null;

comment on table public.basket_selection is
  'Phase 7 user basket preference. Does NOT authorize payment, create orders, '
  'or emit Policy ALLOW. Locked selection_source = USER.';

-- ---------------------------------------------------------------------------
-- basket_quote (authoritative quote version for authorization tracing)
-- ---------------------------------------------------------------------------
create table if not exists public.basket_quote (
  quote_id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.basket (basket_id),
  session_id uuid not null references public.shopping_session (session_id),
  user_id uuid not null references public.app_user (user_id),
  selection_id uuid null references public.basket_selection (selection_id),
  optimization_run_id uuid not null
    references public.optimization_run (optimization_run_id),
  quote_version varchar not null,
  basket_state_version integer not null,
  currency varchar(3) not null default 'INR',
  amount_kind text not null default 'AUTHORITATIVE_QUOTE',
  gross_amount_minor bigint not null,
  discount_amount_minor bigint not null,
  final_payable_minor bigint not null,
  lines_json jsonb not null,
  applied_incentives_json jsonb not null default '[]'::jsonb,
  catalog_fingerprint varchar not null,
  incentive_fingerprint varchar not null,
  status text not null default 'CURRENT',
  request_id varchar null,
  created_at timestamptz not null default (timezone('utc', now())),
  superseded_at timestamptz null,
  constraint basket_quote_currency_inr check (currency = 'INR'),
  constraint basket_quote_amount_kind_controlled check (
    amount_kind = 'AUTHORITATIVE_QUOTE'
  ),
  constraint basket_quote_status_controlled check (
    status in ('CURRENT', 'SUPERSEDED', 'STALE')
  ),
  constraint basket_quote_gross_non_negative check (gross_amount_minor >= 0),
  constraint basket_quote_discount_non_negative check (
    discount_amount_minor >= 0
  ),
  constraint basket_quote_final_payable_non_negative check (
    final_payable_minor >= 0
  ),
  constraint basket_quote_discount_not_exceed_gross check (
    discount_amount_minor <= gross_amount_minor
  ),
  constraint basket_quote_version_nonempty check (
    char_length(trim(quote_version)) > 0
  ),
  constraint basket_quote_basket_state_version_positive check (
    basket_state_version >= 1
  )
);

create index if not exists basket_quote_basket_id_idx
  on public.basket_quote (basket_id);

create index if not exists basket_quote_quote_version_idx
  on public.basket_quote (quote_version);

create unique index if not exists basket_quote_basket_version_uidx
  on public.basket_quote (basket_id, quote_version);

-- At most one CURRENT quote per basket.
create unique index if not exists basket_quote_basket_current_uidx
  on public.basket_quote (basket_id)
  where status = 'CURRENT';

comment on table public.basket_quote is
  'Phase 7 authoritative quote version. Client totals are never stored as input. '
  'Stale when basket_state_version or catalog/incentive fingerprints diverge.';

-- policy_decision.basket_id FK remains deferred for writers that use synthetic
-- basket ids in earlier phases; Phase 7 quotes/selections use real basket rows.

alter table public.optimization_run enable row level security;
alter table public.basket enable row level security;
alter table public.basket_item enable row level security;
alter table public.basket_selection enable row level security;
alter table public.basket_quote enable row level security;

insert into public.schema_meta (key, value)
values ('phase', '7')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.schema_meta (key, value)
values (
  'phase7_basket_selection_quote_schema',
  'optimization_run; basket; basket_item; basket_selection; basket_quote; selection≠auth; quote versioning + stale'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
