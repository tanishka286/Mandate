-- Phase 8 Step 4A Security Fix — RPC EXECUTE ACL Lock
-- Restrict execution of SECURITY DEFINER function public.create_checkout_persistence_atomic
-- to trusted backend service_role only. Untrusted client roles (PUBLIC, anon, authenticated)
-- must not be permitted to invoke atomic checkout persistence directly via PostgREST.

revoke execute on function public.create_checkout_persistence_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint, bigint, bigint, text, text, jsonb, text, uuid, text, text, text
) from public;

revoke execute on function public.create_checkout_persistence_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint, bigint, bigint, text, text, jsonb, text, uuid, text, text, text
) from anon;

revoke execute on function public.create_checkout_persistence_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint, bigint, bigint, text, text, jsonb, text, uuid, text, text, text
) from authenticated;

grant execute on function public.create_checkout_persistence_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint, bigint, bigint, text, text, jsonb, text, uuid, text, text, text
) to service_role;
