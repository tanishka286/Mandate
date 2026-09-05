-- Phase 8 Step 2 — Payment Persistence + Payment State Foundation
-- Implements canonical:
--   1. public."order"
--   2. public.payment
--   3. public.checkout_idempotency
--   4. public.razorpay_webhook_event

-- ---------------------------------------------------------------------------
-- 1. canonical order table
-- ---------------------------------------------------------------------------
create table if not exists public."order" (
  order_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user (user_id),
  session_id uuid not null references public.shopping_session (session_id),
  mandate_id uuid not null references public.mandate (mandate_id),
  basket_id uuid not null references public.basket (basket_id),
  policy_decision_id uuid not null references public.policy_decision (policy_decision_id),
  status text not null default 'CREATED',
  gross_amount_minor bigint not null,
  discount_amount_minor bigint not null default 0,
  final_payable_minor bigint not null,
  currency varchar(3) not null default 'INR',
  razorpay_order_id varchar null,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint order_status_controlled check (
    status in (
      'CREATED',
      'PAYMENT_PENDING',
      'PAYMENT_VERIFIED',
      'PAYMENT_FAILED',
      'PAYMENT_CANCELLED',
      'PAYMENT_EXPIRED'
    )
  ),
  constraint order_currency_inr check (currency = 'INR'),
  constraint order_gross_amount_minor_non_negative check (gross_amount_minor >= 0),
  constraint order_discount_amount_minor_non_negative check (discount_amount_minor >= 0),
  constraint order_final_payable_minor_non_negative check (final_payable_minor >= 0),
  constraint order_discount_not_exceed_gross check (discount_amount_minor <= gross_amount_minor),
  constraint order_razorpay_order_id_unique unique (razorpay_order_id)
);

create index if not exists order_user_id_idx on public."order" (user_id);
create index if not exists order_session_id_idx on public."order" (session_id);
create index if not exists order_mandate_id_idx on public."order" (mandate_id);
create index if not exists order_basket_id_idx on public."order" (basket_id);
create index if not exists order_policy_decision_id_idx on public."order" (policy_decision_id);
create index if not exists order_status_idx on public."order" (status);

-- Trigger to verify order references an ALLOW policy decision matching basket and mandate
create or replace function public.trg_order_validate_authorization()
returns trigger as $$
declare
  v_decision text;
  v_basket_id uuid;
  v_mandate_id uuid;
begin
  select decision, basket_id, mandate_id
    into v_decision, v_basket_id, v_mandate_id
    from public.policy_decision
   where policy_decision_id = NEW.policy_decision_id;

  if not found then
    raise exception 'Referenced policy decision % does not exist', NEW.policy_decision_id;
  end if;

  if v_decision <> 'ALLOW' then
    raise exception 'Order authorization requires an ALLOW policy decision, found: %', v_decision;
  end if;

  if v_basket_id <> NEW.basket_id then
    raise exception 'Order basket_id % does not match policy decision basket_id %', NEW.basket_id, v_basket_id;
  end if;

  if v_mandate_id <> NEW.mandate_id then
    raise exception 'Order mandate_id % does not match policy decision mandate_id %', NEW.mandate_id, v_mandate_id;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists order_validate_authorization on public."order";
create trigger order_validate_authorization
  before insert or update of policy_decision_id, basket_id, mandate_id
  on public."order"
  for each row
  execute function public.trg_order_validate_authorization();

comment on table public."order" is
  'Phase 8 canonical order table. Represents authoritative order created after '
  'successful policy authorization of a basket. Status lifecycle: CREATED -> PAYMENT_PENDING -> ...';

-- ---------------------------------------------------------------------------
-- 2. canonical payment table
-- ---------------------------------------------------------------------------
create table if not exists public.payment (
  payment_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public."order" (order_id),
  razorpay_payment_id varchar null,
  status text not null default 'PAYMENT_PENDING',
  amount_minor bigint not null,
  currency varchar(3) not null default 'INR',
  method varchar null,
  verified_at timestamptz null,
  failure_code varchar null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint payment_status_controlled check (
    status in (
      'PAYMENT_PENDING',
      'VERIFIED',
      'FAILED',
      'CANCELLED',
      'EXPIRED'
    )
  ),
  constraint payment_currency_inr check (currency = 'INR'),
  constraint payment_amount_minor_non_negative check (amount_minor >= 0),
  constraint payment_razorpay_payment_id_unique unique (razorpay_payment_id)
);

create index if not exists payment_order_id_idx on public.payment (order_id);
create index if not exists payment_status_idx on public.payment (status);

-- Trigger to ensure payment amount matches order final_payable_minor
create or replace function public.trg_payment_validate_amount()
returns trigger as $$
declare
  v_final_payable bigint;
begin
  select final_payable_minor
    into v_final_payable
    from public."order"
   where order_id = NEW.order_id;

  if not found then
    raise exception 'Referenced order % does not exist', NEW.order_id;
  end if;

  if NEW.amount_minor <> v_final_payable then
    raise exception 'Payment amount % does not match order final_payable_minor %', NEW.amount_minor, v_final_payable;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists payment_validate_amount on public.payment;
create trigger payment_validate_amount
  before insert
  on public.payment
  for each row
  execute function public.trg_payment_validate_amount();

comment on table public.payment is
  'Phase 8 canonical payment table. Tracks payment lifecycle for an order. '
  'Deterministic transitions: PAYMENT_PENDING -> VERIFIED | FAILED | CANCELLED | EXPIRED.';

-- ---------------------------------------------------------------------------
-- 3. checkout idempotency table
-- ---------------------------------------------------------------------------
create table if not exists public.checkout_idempotency (
  idempotency_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user (user_id),
  idempotency_key varchar not null,
  request_fingerprint varchar not null,
  order_id uuid null references public."order" (order_id),
  response_json jsonb null,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint checkout_idempotency_user_key_unique unique (user_id, idempotency_key),
  constraint checkout_idempotency_key_nonempty check (char_length(trim(idempotency_key)) > 0),
  constraint checkout_idempotency_fingerprint_nonempty check (char_length(trim(request_fingerprint)) > 0)
);

create index if not exists checkout_idempotency_user_id_idx on public.checkout_idempotency (user_id);
create index if not exists checkout_idempotency_order_id_idx on public.checkout_idempotency (order_id);

comment on table public.checkout_idempotency is
  'Phase 8 durable checkout idempotency. Scoped to UNIQUE(user_id, idempotency_key). '
  'Distinct from policy decision idempotency.';

-- ---------------------------------------------------------------------------
-- 4. razorpay webhook event table
-- ---------------------------------------------------------------------------
create table if not exists public.razorpay_webhook_event (
  webhook_event_id uuid primary key default gen_random_uuid(),
  event_id varchar not null unique,
  event_type varchar not null,
  payload_hash varchar null,
  received_at timestamptz not null default (timezone('utc', now())),
  processed_at timestamptz null,
  processing_status text not null default 'RECEIVED',
  error_code varchar null,
  payload_json jsonb null,
  created_at timestamptz not null default (timezone('utc', now())),
  updated_at timestamptz not null default (timezone('utc', now())),
  constraint razorpay_webhook_event_processing_status_controlled check (
    processing_status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED')
  ),
  constraint razorpay_webhook_event_id_nonempty check (char_length(trim(event_id)) > 0),
  constraint razorpay_webhook_event_type_nonempty check (char_length(trim(event_type)) > 0)
);

create index if not exists razorpay_webhook_event_processing_status_idx
  on public.razorpay_webhook_event (processing_status);
create index if not exists razorpay_webhook_event_received_at_idx
  on public.razorpay_webhook_event (received_at desc);

comment on table public.razorpay_webhook_event is
  'Phase 8 durable Razorpay webhook event persistence. Deduplicated by unique event_id.';

-- ---------------------------------------------------------------------------
-- RLS & schema metadata
-- ---------------------------------------------------------------------------
alter table public."order" enable row level security;
alter table public.payment enable row level security;
alter table public.checkout_idempotency enable row level security;
alter table public.razorpay_webhook_event enable row level security;

insert into public.schema_meta (key, value)
values ('phase', '8')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.schema_meta (key, value)
values (
  'phase8_payment_persistence',
  'order; payment; checkout_idempotency; razorpay_webhook_event; payment state machine'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
