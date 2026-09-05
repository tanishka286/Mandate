-- Phase 8 Step 4A — Checkout Persistence Atomicity
-- Implements atomic checkout persistence via a single PostgreSQL transaction:
--   1. public."order"
--   2. public.payment
--   3. public.checkout_idempotency
--
-- Name: create_checkout_persistence_atomic

create or replace function public.create_checkout_persistence_atomic(
  p_order_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_mandate_id uuid,
  p_basket_id uuid,
  p_policy_decision_id uuid,
  p_gross_amount_minor bigint,
  p_discount_amount_minor bigint,
  p_final_payable_minor bigint,
  p_payment_amount_minor bigint,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_response_json jsonb,
  p_razorpay_order_id text default null,
  p_payment_id uuid default null,
  p_currency text default 'INR',
  p_order_status text default 'PAYMENT_PENDING',
  p_payment_status text default 'PAYMENT_PENDING'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trimmed_key text;
  v_existing_idempotency public.checkout_idempotency%rowtype;
  v_order_row public."order"%rowtype;
  v_payment_row public.payment%rowtype;
  v_new_idempotency public.checkout_idempotency%rowtype;
  v_payment_id uuid;
begin
  -- 1. Validate currency invariant
  if p_currency <> 'INR' then
    raise exception 'INVALID_CURRENCY: currency must be INR, got %', p_currency;
  end if;

  -- 2. Validate status invariants
  if p_order_status <> 'PAYMENT_PENDING' then
    raise exception 'INVALID_STATUS: order status must be PAYMENT_PENDING, got %', p_order_status;
  end if;

  if p_payment_status <> 'PAYMENT_PENDING' then
    raise exception 'INVALID_STATUS: payment status must be PAYMENT_PENDING, got %', p_payment_status;
  end if;

  -- 3. Validate amount invariants
  if p_final_payable_minor <> p_payment_amount_minor then
    raise exception 'AMOUNT_MISMATCH: final_payable_minor (%) does not match payment_amount_minor (%)',
      p_final_payable_minor, p_payment_amount_minor;
  end if;

  if p_final_payable_minor < 0 or p_gross_amount_minor < 0 or p_discount_amount_minor < 0 then
    raise exception 'NEGATIVE_AMOUNT: financial amounts must be non-negative';
  end if;

  if p_discount_amount_minor > p_gross_amount_minor then
    raise exception 'INVALID_DISCOUNT: discount_amount_minor (%) cannot exceed gross_amount_minor (%)',
      p_discount_amount_minor, p_gross_amount_minor;
  end if;

  -- 4. Check idempotency concurrency
  v_trimmed_key := trim(p_idempotency_key);
  if char_length(v_trimmed_key) = 0 then
    raise exception 'INVALID_IDEMPOTENCY_KEY: idempotency_key must not be empty';
  end if;

  select * into v_existing_idempotency
    from public.checkout_idempotency
   where user_id = p_user_id
     and idempotency_key = v_trimmed_key;

  if found then
    if v_existing_idempotency.request_fingerprint <> p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: Idempotency-Key was reused with a different request fingerprint';
    end if;

    -- Return existing replayed state
    select * into v_order_row from public."order" where order_id = v_existing_idempotency.order_id;
    select * into v_payment_row from public.payment where order_id = v_existing_idempotency.order_id limit 1;

    return jsonb_build_object(
      'order', to_jsonb(v_order_row),
      'payment', to_jsonb(v_payment_row),
      'idempotency', to_jsonb(v_existing_idempotency),
      'replayed', true
    );
  end if;

  -- 5. Insert public."order"
  -- Existing trigger trg_order_validate_authorization validates ALLOW decision,
  -- basket_id, and mandate_id automatically.
  insert into public."order" (
    order_id,
    user_id,
    session_id,
    mandate_id,
    basket_id,
    policy_decision_id,
    status,
    gross_amount_minor,
    discount_amount_minor,
    final_payable_minor,
    currency,
    razorpay_order_id
  ) values (
    p_order_id,
    p_user_id,
    p_session_id,
    p_mandate_id,
    p_basket_id,
    p_policy_decision_id,
    p_order_status,
    p_gross_amount_minor,
    p_discount_amount_minor,
    p_final_payable_minor,
    p_currency,
    p_razorpay_order_id
  )
  returning * into v_order_row;

  -- 6. Insert public.payment
  -- Existing trigger trg_payment_validate_amount validates amount_minor matches order.
  v_payment_id := coalesce(p_payment_id, gen_random_uuid());
  insert into public.payment (
    payment_id,
    order_id,
    status,
    amount_minor,
    currency
  ) values (
    v_payment_id,
    v_order_row.order_id,
    p_payment_status,
    p_payment_amount_minor,
    p_currency
  )
  returning * into v_payment_row;

  -- 7. Insert public.checkout_idempotency
  insert into public.checkout_idempotency (
    user_id,
    idempotency_key,
    request_fingerprint,
    order_id,
    response_json
  ) values (
    p_user_id,
    v_trimmed_key,
    p_request_fingerprint,
    v_order_row.order_id,
    p_response_json
  )
  returning * into v_new_idempotency;

  return jsonb_build_object(
    'order', to_jsonb(v_order_row),
    'payment', to_jsonb(v_payment_row),
    'idempotency', to_jsonb(v_new_idempotency),
    'replayed', false
  );
end;
$$;

comment on function public.create_checkout_persistence_atomic is
  'Phase 8 Step 4A — Atomically persists application order, initial payment attempt, '
  'and checkout idempotency record in a single database transaction.';
