-- Phase 8 Step 6 — Payment Verification Atomicity
-- Implements atomic payment verification persistence via a single PostgreSQL transaction:
--   1. public.payment (status -> VERIFIED, razorpay_payment_id, verified_at, method)
--   2. public."order" (status -> PAYMENT_VERIFIED)
--
-- Name: verify_payment_persistence_atomic

create or replace function public.verify_payment_persistence_atomic(
  p_order_id uuid,
  p_payment_id uuid default null,
  p_razorpay_payment_id text default null,
  p_verified_at timestamptz default null,
  p_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trimmed_payment_id text;
  v_order_row public."order"%rowtype;
  v_payment_row public.payment%rowtype;
begin
  -- 1. Validate inputs
  if p_order_id is null then
    raise exception 'INVALID_ORDER_ID: order_id is required';
  end if;

  v_trimmed_payment_id := trim(p_razorpay_payment_id);
  if v_trimmed_payment_id is null or char_length(v_trimmed_payment_id) = 0 then
    raise exception 'INVALID_RAZORPAY_PAYMENT_ID: razorpay_payment_id must not be empty';
  end if;

  -- 2. Lock and load application order
  select * into v_order_row
    from public."order"
   where order_id = p_order_id
     for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND: Referenced order % does not exist', p_order_id;
  end if;

  -- 3. Lock and load application payment
  if p_payment_id is not null then
    select * into v_payment_row
      from public.payment
     where payment_id = p_payment_id
       and order_id = p_order_id
       for update;
  else
    select * into v_payment_row
      from public.payment
     where order_id = p_order_id
     order by created_at desc
     limit 1
       for update;
  end if;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND: No payment record found for order %', p_order_id;
  end if;

  -- 4. Idempotency handling
  if v_payment_row.status = 'VERIFIED' then
    if v_payment_row.razorpay_payment_id = v_trimmed_payment_id then
      -- Idempotent retry: return existing verified state
      return jsonb_build_object(
        'order', to_jsonb(v_order_row),
        'payment', to_jsonb(v_payment_row),
        'replayed', true
      );
    else
      -- Conflicting provider payment ID
      raise exception 'PAYMENT_ALREADY_VERIFIED_CONFLICT: Payment is already verified with a different provider payment ID';
    end if;
  end if;

  -- 5. Deterministic state transition validation
  if v_payment_row.status <> 'PAYMENT_PENDING' then
    raise exception 'INVALID_STATE_TRANSITION: Cannot transition payment from % to VERIFIED', v_payment_row.status;
  end if;

  -- 6. Atomically update payment
  update public.payment
     set status = 'VERIFIED',
         razorpay_payment_id = v_trimmed_payment_id,
         verified_at = coalesce(p_verified_at, timezone('utc', now())),
         method = coalesce(p_method, method),
         updated_at = timezone('utc', now())
   where payment_id = v_payment_row.payment_id
  returning * into v_payment_row;

  -- 7. Atomically update order
  update public."order"
     set status = 'PAYMENT_VERIFIED',
         updated_at = timezone('utc', now())
   where order_id = p_order_id
  returning * into v_order_row;

  -- 8. Return updated atomic state
  return jsonb_build_object(
    'order', to_jsonb(v_order_row),
    'payment', to_jsonb(v_payment_row),
    'replayed', false
  );
end;
$$;

-- Security ACL lock: strictly backend service_role only
revoke execute on function public.verify_payment_persistence_atomic(
  uuid, uuid, text, timestamptz, text
) from public;

revoke execute on function public.verify_payment_persistence_atomic(
  uuid, uuid, text, timestamptz, text
) from anon;

revoke execute on function public.verify_payment_persistence_atomic(
  uuid, uuid, text, timestamptz, text
) from authenticated;

grant execute on function public.verify_payment_persistence_atomic(
  uuid, uuid, text, timestamptz, text
) to service_role;
