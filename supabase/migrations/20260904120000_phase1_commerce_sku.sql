-- Phase 1 Step 3 — SKU / Pack (purchasable variant + authoritative price)
-- Depends on Phase 1 Step 2 product table.
-- Does NOT create Stock, Cart, or price fields on product.

create table if not exists public.sku (
  sku_id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product (product_id),
  sku_code text not null,
  pack_quantity numeric not null,
  pack_unit text not null,
  price_minor bigint not null,
  currency varchar(3) not null default 'INR',
  status text not null default 'ACTIVE',
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint sku_code_nonempty check (char_length(trim(sku_code)) > 0),
  constraint sku_code_unique unique (sku_code),
  constraint sku_pack_unit_nonempty check (char_length(trim(pack_unit)) > 0),
  constraint sku_pack_quantity_positive check (pack_quantity > 0),
  constraint sku_price_minor_non_negative check (price_minor >= 0),
  constraint sku_currency_inr check (currency = 'INR'),
  constraint sku_status_controlled check (status in ('ACTIVE', 'INACTIVE'))
);

create index if not exists sku_product_id_idx
  on public.sku (product_id);

create index if not exists sku_product_id_status_idx
  on public.sku (product_id, status);

comment on table public.sku is
  'Phase 1 SKU/pack variant. Authoritative price lives here. Stock is a separate later entity.';

comment on column public.sku.price_minor is
  'Authoritative INR price in integer paise. Never accept client-supplied prices as authority.';

comment on column public.sku.pack_quantity is
  'Units contained in this pack (DECIMAL/NUMERIC). Must be positive.';

comment on column public.sku.status is
  'Catalog status ACTIVE|INACTIVE. Not inventory availability (Stock).';

-- Backend (service role) remains the authorization boundary.
alter table public.sku enable row level security;

-- Keep operational phase metadata at Phase 1 (do not advance phase number).
insert into public.schema_meta (key, value)
values ('phase', '1')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
