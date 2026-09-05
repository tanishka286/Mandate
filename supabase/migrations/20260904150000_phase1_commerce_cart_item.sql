-- Phase 1 Step 7 — Cart items (Cart → SKU → quantity)
-- Depends on cart + sku. Does NOT store prices or totals.

create table if not exists public.cart_item (
  cart_item_id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.cart (cart_id) on delete cascade,
  sku_id uuid not null references public.sku (sku_id),
  quantity integer not null,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint cart_item_quantity_positive check (quantity >= 1),
  constraint cart_item_cart_sku_unique unique (cart_id, sku_id)
);

create index if not exists cart_item_cart_id_idx
  on public.cart_item (cart_id);

create index if not exists cart_item_sku_id_idx
  on public.cart_item (sku_id);

comment on table public.cart_item is
  'Phase 1 cart line: cart owns quantity of a SKU. Price/totals are not stored here.';

comment on column public.cart_item.quantity is
  'Positive integer pack count requested in the cart. Stock is validated but not reserved.';

alter table public.cart_item enable row level security;

-- Keep operational phase metadata at Phase 1.
insert into public.schema_meta (key, value)
values ('phase', '1')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
