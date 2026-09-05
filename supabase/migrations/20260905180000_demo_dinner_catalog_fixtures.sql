-- Demo dinner catalog fixtures (TEST B): rice, paneer, chapati, salad.
-- Authoritative prices/stock only — never frontend-invented.
-- Preserves all existing Phase 1–10 seed rows.

insert into public.category (category_id, code, name)
values
  ('11111111-1111-4111-8111-111111111102', 'pantry', 'Pantry'),
  ('11111111-1111-4111-8111-111111111103', 'produce', 'Produce')
on conflict (code) do update
set name = excluded.name,
    updated_at = timezone('utc', now());

insert into public.product (
  product_id,
  name,
  description,
  category_id,
  brand,
  status
)
values
  (
    '22222222-2222-4222-8222-222222222207',
    'Basmati Rice',
    'Long-grain basmati rice for everyday meals.',
    '11111111-1111-4111-8111-111111111102',
    'GrainCo',
    'ACTIVE'
  ),
  (
    '22222222-2222-4222-8222-222222222208',
    'Fresh Paneer',
    'Soft cottage cheese for Indian cooking.',
    '11111111-1111-4111-8111-111111111101',
    'DairyLand',
    'ACTIVE'
  ),
  (
    '22222222-2222-4222-8222-222222222209',
    'Whole Wheat Chapati',
    'Ready-to-cook whole wheat chapati.',
    '11111111-1111-4111-8111-111111111102',
    'BakeHouse',
    'ACTIVE'
  ),
  (
    '22222222-2222-4222-8222-222222222210',
    'Garden Salad Mix',
    'Fresh mixed salad greens.',
    '11111111-1111-4111-8111-111111111103',
    'GreenLeaf',
    'ACTIVE'
  )
on conflict (product_id) do update
set name = excluded.name,
    description = excluded.description,
    category_id = excluded.category_id,
    brand = excluded.brand,
    status = excluded.status,
    updated_at = timezone('utc', now());

insert into public.sku (
  sku_id,
  product_id,
  sku_code,
  pack_quantity,
  pack_unit,
  price_minor,
  currency,
  status
)
values
  (
    '33333333-3333-4333-8333-333333333309',
    '22222222-2222-4222-8222-222222222207',
    'BASMATI-RICE-1KG',
    1,
    'kg',
    7000,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333310',
    '22222222-2222-4222-8222-222222222208',
    'PANEER-500G',
    0.5,
    'kg',
    9000,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333311',
    '22222222-2222-4222-8222-222222222208',
    'PANEER-PREMIUM-500G',
    0.5,
    'kg',
    11000,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333312',
    '22222222-2222-4222-8222-222222222209',
    'CHAPATI-5PK',
    5,
    'pieces',
    3500,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333313',
    '22222222-2222-4222-8222-222222222210',
    'SALAD-1KG',
    1,
    'kg',
    5500,
    'INR',
    'ACTIVE'
  )
on conflict (sku_code) do update
set product_id = excluded.product_id,
    pack_quantity = excluded.pack_quantity,
    pack_unit = excluded.pack_unit,
    price_minor = excluded.price_minor,
    currency = excluded.currency,
    status = excluded.status,
    updated_at = timezone('utc', now());

insert into public.stock (sku_id, available_quantity)
values
  ('33333333-3333-4333-8333-333333333309', 50),
  ('33333333-3333-4333-8333-333333333310', 40),
  ('33333333-3333-4333-8333-333333333311', 30),
  ('33333333-3333-4333-8333-333333333312', 60),
  ('33333333-3333-4333-8333-333333333313', 35)
on conflict (sku_id) do update
set available_quantity = excluded.available_quantity,
    updated_at = timezone('utc', now());

insert into public.quality_evidence (
  evidence_id,
  product_id,
  sku_id,
  source_type,
  source_reference,
  summary,
  quality_signal,
  confidence,
  captured_at,
  expires_at,
  created_at
)
values
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee09',
    '22222222-2222-4222-8222-222222222207',
    '33333333-3333-4333-8333-333333333309',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:rice-good',
    'Consistent positive quality signals for everyday basmati rice.',
    'GOOD',
    0.82,
    '2026-09-05T08:00:00+00:00',
    null,
    '2026-09-05T08:00:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10',
    '22222222-2222-4222-8222-222222222208',
    '33333333-3333-4333-8333-333333333310',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:paneer-good',
    'Generally positive quality signals for everyday paneer.',
    'GOOD',
    0.80,
    '2026-09-05T08:30:00+00:00',
    null,
    '2026-09-05T08:30:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11',
    '22222222-2222-4222-8222-222222222208',
    '33333333-3333-4333-8333-333333333311',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:paneer-premium',
    'Strong positive quality signals for premium paneer.',
    'PREMIUM',
    0.88,
    '2026-09-05T09:00:00+00:00',
    null,
    '2026-09-05T09:00:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee12',
    '22222222-2222-4222-8222-222222222209',
    '33333333-3333-4333-8333-333333333312',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:chapati-good',
    'Positive quality signals for whole wheat chapati.',
    'GOOD',
    0.78,
    '2026-09-05T09:30:00+00:00',
    null,
    '2026-09-05T09:30:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee13',
    '22222222-2222-4222-8222-222222222210',
    '33333333-3333-4333-8333-333333333313',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:salad-acceptable',
    'Acceptable quality signals for mixed salad greens.',
    'ACCEPTABLE',
    0.72,
    '2026-09-05T10:00:00+00:00',
    null,
    '2026-09-05T10:00:00+00:00'
  )
on conflict (evidence_id) do update
set product_id = excluded.product_id,
    sku_id = excluded.sku_id,
    source_type = excluded.source_type,
    source_reference = excluded.source_reference,
    summary = excluded.summary,
    quality_signal = excluded.quality_signal,
    confidence = excluded.confidence,
    captured_at = excluded.captured_at,
    expires_at = excluded.expires_at,
    created_at = excluded.created_at;
