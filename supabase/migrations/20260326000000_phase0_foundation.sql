-- Phase 0 foundation migration
-- Does NOT create the full Mandate commerce schema.
-- Domain tables (User, Mandate, Basket, Order, Payment, etc.) arrive in later phases.

create extension if not exists "pgcrypto";

-- Schema metadata for operational readiness checks
create table if not exists public.schema_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default (timezone('utc', now()))
);

comment on table public.schema_meta is
  'Phase 0 operational metadata. Authoritative commerce tables are added in later roadmap phases.';

insert into public.schema_meta (key, value)
values ('phase', '0'), ('project', 'mandate')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

-- Backend (service role) is the authorization boundary.
-- RLS enabled as a baseline; no complex policies yet.
alter table public.schema_meta enable row level security;
