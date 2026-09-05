-- Phase 1 Step 4 — Stock (inventory availability)
-- Depends on Phase 1 Step 3 sku table.
-- Does NOT create Cart, price fields on product, or stock mutation APIs.

create table if not exists public.stock (
  sku_id uuid primary key references public.sku (sku_id),
  available_quantity numeric not null,
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint stock_available_quantity_non_negative check (available_quantity >= 0)
);

comment on table public.stock is
  'Phase 1 authoritative inventory availability per SKU. Distinct from SKU ACTIVE/INACTIVE status.';

comment on column public.stock.available_quantity is
  'Currently available inventory units. 0 means out of stock. Never invent on read.';

comment on column public.stock.sku_id is
  'One stock row per SKU (purchasable pack). FK to sku.sku_id.';

-- Backend (service role) remains the authorization boundary.
alter table public.stock enable row level security;

-- Keep operational phase metadata at Phase 1 (do not advance phase number).
insert into public.schema_meta (key, value)
values ('phase', '1')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
