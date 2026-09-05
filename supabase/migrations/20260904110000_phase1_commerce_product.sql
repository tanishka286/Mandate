-- Phase 1 Step 2 — Product (catalog identity)
-- Depends on Phase 1 Step 1 category table.
-- Does NOT create SKU, Stock, Cart, or price/stock columns on product.

create table if not exists public.product (
  product_id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category_id uuid not null references public.category (category_id),
  brand text null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint product_name_nonempty check (char_length(trim(name)) > 0),
  constraint product_status_controlled check (status in ('ACTIVE', 'INACTIVE'))
);

create index if not exists product_category_id_idx
  on public.product (category_id);

comment on table public.product is
  'Phase 1 product catalog identity. Price and stock belong to SKU/Stock (later steps), not Product.';

comment on column public.product.category_id is
  'Foreign key to controlled category. Category code/name are not duplicated as authoritative product fields.';

comment on column public.product.status is
  'Controlled product status: ACTIVE | INACTIVE.';

-- Backend (service role) remains the authorization boundary.
alter table public.product enable row level security;

-- Keep operational phase metadata at Phase 1 (do not advance phase number).
insert into public.schema_meta (key, value)
values ('phase', '1')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
