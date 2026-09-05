-- Phase 3 Step 1 — Shopping session persistence foundation
-- Depends on Phase 1 app_user. Does NOT create shopping_intent, requirements,
-- agent runs, baskets, payment authorization, or AI mutation paths.
-- A shopping session groups one shopping workflow; it is NOT a payment authorization.

create table if not exists public.shopping_session (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user (user_id),
  status text not null default 'ACTIVE',
  started_at timestamptz not null default (timezone('utc', now())),
  ended_at timestamptz null,
  created_at timestamptz not null default (timezone('utc', now())),
  constraint shopping_session_status_controlled check (
    status in ('ACTIVE', 'ENDED')
  ),
  constraint shopping_session_ended_at_matches_status check (
    (status = 'ACTIVE' and ended_at is null)
    or (status = 'ENDED' and ended_at is not null)
  )
);

create index if not exists shopping_session_user_id_idx
  on public.shopping_session (user_id);

create index if not exists shopping_session_user_id_status_idx
  on public.shopping_session (user_id, status);

comment on table public.shopping_session is
  'Phase 3 shopping session: groups one shopping workflow for an authenticated user. '
  'Not a payment authorization. Intent/requirements arrive in later Phase 3 steps.';

comment on column public.shopping_session.status is
  'Lifecycle: ACTIVE (workflow open; Doc 08 create-intent gate) → ENDED (workflow closed). '
  'ACTIVE requires ended_at NULL; ENDED requires ended_at set.';

comment on column public.shopping_session.started_at is
  'UTC timestamp when the shopping workflow started.';

comment on column public.shopping_session.ended_at is
  'UTC timestamp when the session ended. NULL while ACTIVE.';

comment on column public.shopping_session.created_at is
  'UTC row creation timestamp.';

-- Backend (service role) remains the authorization boundary (same ownership model as cart/mandate).
alter table public.shopping_session enable row level security;

-- Advance operational phase metadata to Phase 3.
insert into public.schema_meta (key, value)
values ('phase', '3')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.schema_meta (key, value)
values (
  'phase3_shopping_session_schema',
  'shopping_session; lifecycle ACTIVE|ENDED; intent/requirements deferred'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
