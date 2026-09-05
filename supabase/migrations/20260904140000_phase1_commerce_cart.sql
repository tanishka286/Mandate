-- Phase 1 Step 6 — Cart foundation (ownership + lifecycle only)
-- Creates minimal app_user identity (required for cart FK; not present in earlier migrations)
-- and the cart table. Does NOT create cart_item or totals.

-- Minimal application user for cart ownership (Doc 07 user model, table name app_user).
create table if not exists public.app_user (
  user_id uuid primary key default gen_random_uuid(),
  display_name text not null default '',
  currency varchar(3) not null default 'INR',
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint app_user_currency_inr check (currency = 'INR')
);

comment on table public.app_user is
  'Phase 1 minimal application user identity for cart ownership. Not a full auth product.';

alter table public.app_user enable row level security;

-- Cart: one OPEN_CART per user; no line items/totals in this step.
create table if not exists public.cart (
  cart_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user (user_id),
  status text not null default 'OPEN_CART',
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint cart_status_controlled check (status in ('OPEN_CART', 'CANCELLED'))
);

-- At most one active (OPEN_CART) cart per user.
create unique index if not exists cart_one_open_per_user_idx
  on public.cart (user_id)
  where (status = 'OPEN_CART');

create index if not exists cart_user_id_idx
  on public.cart (user_id);

comment on table public.cart is
  'Phase 1 cart foundation. Ownership/lifecycle only. Cart items and totals arrive in later steps.';

comment on column public.cart.status is
  'OPEN_CART = active shopping cart; CANCELLED = closed without checkout. No payment states here.';

alter table public.cart enable row level security;

-- Keep operational phase metadata at Phase 1.
insert into public.schema_meta (key, value)
values ('phase', '1')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
