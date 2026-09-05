-- Phase 8 Step 7 — Razorpay webhook atomic claim + failure persistence
-- Provides database-enforced webhook idempotency and safe payment failure transitions.

-- ---------------------------------------------------------------------------
-- claim_razorpay_webhook_event_atomic
-- Atomically inserts or claims a webhook event for processing.
-- Concurrent duplicate deliveries converge to a single processing path.
-- ---------------------------------------------------------------------------
create or replace function public.claim_razorpay_webhook_event_atomic(
  p_event_id varchar,
  p_event_type varchar,
  p_payload_hash varchar default null,
  p_payload_json jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.razorpay_webhook_event%rowtype;
  v_updated public.razorpay_webhook_event%rowtype;
begin
  if p_event_id is null or char_length(trim(p_event_id)) = 0 then
    raise exception 'INVALID_EVENT_ID: event_id is required';
  end if;

  insert into public.razorpay_webhook_event (
    event_id,
    event_type,
    payload_hash,
    payload_json,
    processing_status
  ) values (
    trim(p_event_id),
    coalesce(p_event_type, 'unknown'),
    p_payload_hash,
    p_payload_json,
    'RECEIVED'
  )
  on conflict (event_id) do nothing
  returning * into v_row;

  if found then
    update public.razorpay_webhook_event
       set processing_status = 'PROCESSING',
           updated_at = timezone('utc', now())
     where webhook_event_id = v_row.webhook_event_id
       and processing_status = 'RECEIVED'
    returning * into v_updated;

    return jsonb_build_object(
      'webhook_event', to_jsonb(coalesce(v_updated, v_row)),
      'claimed', true,
      'already_processed', false,
      'is_duplicate_delivery', false
    );
  end if;

  select * into v_row
    from public.razorpay_webhook_event
   where event_id = trim(p_event_id)
     for update;

  if not found then
    raise exception 'WEBHOOK_CLAIM_RACE: failed to claim webhook event %', p_event_id;
  end if;

  if v_row.processing_status in ('PROCESSED', 'IGNORED') then
    return jsonb_build_object(
      'webhook_event', to_jsonb(v_row),
      'claimed', false,
      'already_processed', true,
      'is_duplicate_delivery', true
    );
  end if;

  if v_row.processing_status = 'PROCESSING' then
    return jsonb_build_object(
      'webhook_event', to_jsonb(v_row),
      'claimed', false,
      'already_processed', false,
      'is_duplicate_delivery', true
    );
  end if;

  update public.razorpay_webhook_event
     set processing_status = 'PROCESSING',
         updated_at = timezone('utc', now())
   where webhook_event_id = v_row.webhook_event_id
     and processing_status in ('RECEIVED', 'FAILED')
  returning * into v_updated;

  if found then
    return jsonb_build_object(
      'webhook_event', to_jsonb(v_updated),
      'claimed', true,
      'already_processed', false,
      'is_duplicate_delivery', true
    );
  end if;

  return jsonb_build_object(
    'webhook_event', to_jsonb(v_row),
    'claimed', false,
    'already_processed', false,
    'is_duplicate_delivery', true
  );
end;
$$;

revoke execute on function public.claim_razorpay_webhook_event_atomic(
  varchar, varchar, varchar, jsonb
) from public;

revoke execute on function public.claim_razorpay_webhook_event_atomic(
  varchar, varchar, varchar, jsonb
) from anon;

revoke execute on function public.claim_razorpay_webhook_event_atomic(
  varchar, varchar, varchar, jsonb
) from authenticated;

grant execute on function public.claim_razorpay_webhook_event_atomic(
  varchar, varchar, varchar, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- process_webhook_payment_failure_atomic
-- Atomically transitions PAYMENT_PENDING -> FAILED without downgrading VERIFIED.
-- ---------------------------------------------------------------------------
create or replace function public.process_webhook_payment_failure_atomic(
  p_order_id uuid,
  p_payment_id uuid default null,
  p_razorpay_payment_id text default null,
  p_failure_code text default null
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
  if p_order_id is null then
    raise exception 'INVALID_ORDER_ID: order_id is required';
  end if;

  v_trimmed_payment_id := nullif(trim(p_razorpay_payment_id), '');

  select * into v_order_row
    from public."order"
   where order_id = p_order_id
     for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND: Referenced order % does not exist', p_order_id;
  end if;

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

  if v_payment_row.status = 'VERIFIED' then
    return jsonb_build_object(
      'order', to_jsonb(v_order_row),
      'payment', to_jsonb(v_payment_row),
      'replayed', true,
      'downgrade_prevented', true
    );
  end if;

  if v_payment_row.status = 'FAILED' then
    if v_trimmed_payment_id is not null
       and v_payment_row.razorpay_payment_id is not null
       and v_payment_row.razorpay_payment_id <> v_trimmed_payment_id then
      raise exception 'PAYMENT_ALREADY_FAILED_CONFLICT: Payment failed with a different provider payment ID';
    end if;

    return jsonb_build_object(
      'order', to_jsonb(v_order_row),
      'payment', to_jsonb(v_payment_row),
      'replayed', true,
      'downgrade_prevented', false
    );
  end if;

  if v_payment_row.status <> 'PAYMENT_PENDING' then
    raise exception 'INVALID_STATE_TRANSITION: Cannot transition payment from % to FAILED', v_payment_row.status;
  end if;

  update public.payment
     set status = 'FAILED',
         razorpay_payment_id = coalesce(v_trimmed_payment_id, razorpay_payment_id),
         failure_code = coalesce(nullif(trim(p_failure_code), ''), failure_code),
         updated_at = timezone('utc', now())
   where payment_id = v_payment_row.payment_id
  returning * into v_payment_row;

  if v_order_row.status = 'PAYMENT_PENDING' then
    update public."order"
       set status = 'PAYMENT_FAILED',
           updated_at = timezone('utc', now())
     where order_id = p_order_id
    returning * into v_order_row;
  end if;

  return jsonb_build_object(
    'order', to_jsonb(v_order_row),
    'payment', to_jsonb(v_payment_row),
    'replayed', false,
    'downgrade_prevented', false
  );
end;
$$;

revoke execute on function public.process_webhook_payment_failure_atomic(
  uuid, uuid, text, text
) from public;

revoke execute on function public.process_webhook_payment_failure_atomic(
  uuid, uuid, text, text
) from anon;

revoke execute on function public.process_webhook_payment_failure_atomic(
  uuid, uuid, text, text
) from authenticated;

grant execute on function public.process_webhook_payment_failure_atomic(
  uuid, uuid, text, text
) to service_role;
