-- Phase 0 seed - minimal metadata only.
-- Do not seed grocery catalogs here.

insert into public.schema_meta (key, value)
values
  ('seeded', 'true'),
  ('environment', 'local')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
