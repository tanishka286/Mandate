-- Phase 3 Step 2 — Shopping intent persistence foundation
-- Depends on Phase 3 Step 1 shopping_session and Phase 2 mandate.
-- Does NOT create requirements, extraction, agent runs, or HTTP create-intent flow.
-- budget_minor is planning input only; mandate remains the authorization ceiling.

create table if not exists public.shopping_intent (
  intent_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.shopping_session (session_id),
  mandate_id uuid not null references public.mandate (mandate_id),
  goal_text text not null,
  category varchar not null,
  budget_minor bigint null,
  quality_preference varchar null,
  status text not null default 'CREATED',
  assumptions_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint shopping_intent_goal_text_nonempty check (
    char_length(trim(goal_text)) > 0
  ),
  constraint shopping_intent_category_nonempty check (
    char_length(trim(category)) > 0
  ),
  constraint shopping_intent_budget_minor_non_negative check (
    budget_minor is null or budget_minor >= 0
  ),
  constraint shopping_intent_quality_preference_nonempty check (
    quality_preference is null
    or char_length(trim(quality_preference)) > 0
  ),
  constraint shopping_intent_status_controlled check (
    status in ('CREATED', 'PLANNING')
  )
);

create index if not exists shopping_intent_session_id_idx
  on public.shopping_intent (session_id);

create index if not exists shopping_intent_mandate_id_idx
  on public.shopping_intent (mandate_id);

create index if not exists shopping_intent_session_id_status_idx
  on public.shopping_intent (session_id, status);

comment on table public.shopping_intent is
  'Phase 3 shopping intent: natural-language grocery goal bound to a session + mandate. '
  'budget_minor is planning input only — mandate/policy remain the authorization ceiling. '
  'Requirements extraction is deferred to a later Phase 3 step.';

comment on column public.shopping_intent.goal_text is
  'Original user natural-language grocery goal. Not transformed into requirements here.';

comment on column public.shopping_intent.category is
  'Planning category label for the intent (e.g. grocery). Not a catalog taxonomy.';

comment on column public.shopping_intent.budget_minor is
  'Optional user-stated planning budget in integer INR paise. Never floating point. '
  'Not an authoritative authorization ceiling.';

comment on column public.shopping_intent.quality_preference is
  'Optional user-stated quality preference. NULL when not supplied.';

comment on column public.shopping_intent.status is
  'Lifecycle: CREATED (Doc 08 create response) → PLANNING (Doc 08 extract-requirements gate). '
  'No other states invented in Phase 3 Step 2.';

comment on column public.shopping_intent.assumptions_json is
  'Explicit assumptions for the intent (default empty JSON array). '
  'Not a substitute for structured requirements; not authoritative financial state.';

-- Backend (service role) remains the authorization boundary.
-- Ownership is enforced in application logic via shopping_session.user_id
-- (same RLS-enabled, no-policy pattern as cart/mandate/shopping_session).
alter table public.shopping_intent enable row level security;

-- Keep operational phase at Phase 3; record Step 2 schema lock.
insert into public.schema_meta (key, value)
values ('phase', '3')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.schema_meta (key, value)
values (
  'phase3_shopping_intent_schema',
  'shopping_intent; lifecycle CREATED|PLANNING; requirements extraction deferred'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
