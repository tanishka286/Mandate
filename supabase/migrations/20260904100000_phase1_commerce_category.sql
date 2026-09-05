-- Phase 1 Step 1 — Category foundation
-- Creates the controlled category lookup used by later commerce entities.
-- Does NOT create Product, SKU, Stock, Cart, or other Phase 1+ tables yet.

create extension if not exists "pgcrypto";

create table if not exists public.category (
  category_id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint category_code_nonempty check (char_length(trim(code)) > 0),
  constraint category_name_nonempty check (char_length(trim(name)) > 0),
  constraint category_code_unique unique (code)
);

comment on table public.category is
  'Phase 1 controlled grocery category codes. Authoritative lookup for catalog commerce.';

comment on column public.category.code is
  'Stable controlled category code (e.g. dairy, pantry). Unique.';

comment on column public.category.name is
  'Human-readable display name for the category.';

-- Backend (service role) remains the authorization boundary.
alter table public.category enable row level security;

-- Advance operational phase metadata to Phase 1 (category foundation).
insert into public.schema_meta (key, value)
values ('phase', '1')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
