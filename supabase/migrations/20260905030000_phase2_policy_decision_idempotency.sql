-- Phase 2 Step 5 — Durable policy authorization idempotency
-- Additive only. Does NOT modify 20260905020000_phase2_policy_decision.sql.
--
-- Scope: UNIQUE (user_id, idempotency_key) per authenticated principal (Doc 07 §22).
-- Historical rows may leave the new columns NULL (no fabricated backfill).
-- Application MUST supply all three columns on every new evaluation insert.
--
-- NOT NULL cannot be applied safely while historical nullable rows may exist.

alter table public.policy_decision
  add column if not exists user_id uuid null references public.app_user (user_id),
  add column if not exists idempotency_key varchar null,
  add column if not exists request_fingerprint varchar null;

alter table public.policy_decision
  drop constraint if exists policy_decision_idempotency_key_nonempty;

alter table public.policy_decision
  add constraint policy_decision_idempotency_key_nonempty
    check (
      idempotency_key is null
      or char_length(trim(idempotency_key)) > 0
    );

alter table public.policy_decision
  drop constraint if exists policy_decision_request_fingerprint_nonempty;

alter table public.policy_decision
  add constraint policy_decision_request_fingerprint_nonempty
    check (
      request_fingerprint is null
      or char_length(trim(request_fingerprint)) > 0
    );

-- One authorization decision per (user, idempotency key). Cross-user keys are independent.
-- Partial unique index allows historical NULL keys without collision.
drop index if exists public.policy_decision_user_idempotency_key_uidx;

create unique index policy_decision_user_idempotency_key_uidx
  on public.policy_decision (user_id, idempotency_key)
  where idempotency_key is not null and user_id is not null;

comment on column public.policy_decision.user_id is
  'Authenticated authorization principal. Must equal mandate.user_id for persisted rows.';

comment on column public.policy_decision.idempotency_key is
  'HTTP Idempotency-Key for POST /policy/evaluate. Distinct from request_id (X-Request-ID).';

comment on column public.policy_decision.request_fingerprint is
  'SHA-256 hex of canonical {basket_id, mandate_id, quote_version}. Used for replay vs IDEMPOTENCY_CONFLICT.';

-- Narrow invariant: persisted user_id must own the referenced mandate.
create or replace function public.policy_decision_enforce_user_matches_mandate()
returns trigger
language plpgsql
as $$
declare
  mandate_owner uuid;
begin
  if new.user_id is null then
    raise exception 'policy_decision.user_id is required for new authorization writes'
      using errcode = '23514';
  end if;

  select m.user_id
    into mandate_owner
  from public.mandate m
  where m.mandate_id = new.mandate_id;

  if mandate_owner is null then
    raise exception 'policy_decision mandate_id not found'
      using errcode = '23503';
  end if;

  if new.user_id is distinct from mandate_owner then
    raise exception 'policy_decision.user_id must equal mandate.user_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists policy_decision_user_matches_mandate_trg
  on public.policy_decision;

create trigger policy_decision_user_matches_mandate_trg
  before insert on public.policy_decision
  for each row
  execute function public.policy_decision_enforce_user_matches_mandate();

insert into public.schema_meta (key, value)
values (
  'phase2_policy_decision_idempotency',
  'user_id+idempotency_key+request_fingerprint; UNIQUE(user_id,idempotency_key) partial; mandate owner trigger'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
