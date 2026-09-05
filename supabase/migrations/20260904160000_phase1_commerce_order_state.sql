-- Phase 1 Step 9 — Application order state (FINAL Phase 1 commerce-core step)
--
-- AUTHORITATIVE DECISION:
-- The Phase 1 application order/transaction state is persisted on public.cart.
-- Cart.status IS the application order state for Commerce Core.
--
-- States (Phase 1 only):
--   OPEN_CART  — active shopping / application transaction
--   CANCELLED  — closed without checkout/payment
--
-- Payment-provider order states (CREATED, PAYMENT_PENDING, PAYMENT_VERIFIED,
-- PAYMENT_FAILED, PAYMENT_EXPIRED, etc.) are deferred to Phase 8 (Razorpay).
-- Do NOT add a second competing lifecycle table in Phase 1.
--
-- This migration does not invent a parallel application_order / commerce_transaction
-- table: that would duplicate cart.status. It locks the interpretation in schema
-- metadata/comments and keeps the existing controlled status constraint.

comment on table public.cart is
  'Phase 1 application order/transaction state + shopping cart. '
  'Authoritative application states: OPEN_CART | CANCELLED. '
  'Payment/Razorpay order states are out of scope until Phase 8. '
  'Cart items and pricing remain related entities; totals are calculated, not stored here.';

comment on column public.cart.status is
  'Phase 1 application order state. OPEN_CART = active; CANCELLED = terminal without payment. '
  'Allowed transition: OPEN_CART → CANCELLED. Payment states are rejected.';

comment on column public.cart.cart_id is
  'Primary key for the Phase 1 application order/transaction (cart-owned).';

comment on column public.cart.user_id is
  'Owning application user. Never accept client-supplied ownership overrides.';

-- Re-assert Phase 1 status domain (idempotent with Step 6 constraint).
alter table public.cart
  drop constraint if exists cart_status_controlled;

alter table public.cart
  add constraint cart_status_controlled
  check (status in ('OPEN_CART', 'CANCELLED'));

-- Keep operational phase metadata at Phase 1 (Commerce Core complete after this step).
insert into public.schema_meta (key, value)
values ('phase', '1')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.schema_meta (key, value)
values (
  'phase1_application_order_state',
  'cart.status (OPEN_CART|CANCELLED); payment order states deferred to Phase 8'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
