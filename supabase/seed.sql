-- Phase 1–4 seed — commerce core + mandate + quality evidence fixtures (Doc 10).
-- Cart rows are the Phase 1 application order state (OPEN_CART).
-- Cart items are created via API (Phase 1 Step 7); not seeded here.
-- Shopping sessions / intents / Razorpay / optimization are not seeded here.

insert into public.schema_meta (key, value)
values
  ('seeded', 'true'),
  ('environment', 'local'),
  ('phase', '4')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

-- Deterministic MVP category codes (fixed UUIDs for reproducible local/demo use).
insert into public.category (category_id, code, name)
values
  ('11111111-1111-4111-8111-111111111101', 'dairy', 'Dairy'),
  ('11111111-1111-4111-8111-111111111102', 'pantry', 'Pantry'),
  ('11111111-1111-4111-8111-111111111103', 'produce', 'Produce'),
  ('11111111-1111-4111-8111-111111111104', 'beverages', 'Beverages'),
  ('11111111-1111-4111-8111-111111111105', 'household', 'Household')
on conflict (code) do update
set name = excluded.name,
    updated_at = timezone('utc', now());

-- Deterministic grocery products (catalog identity only — no price/stock on product).
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
    '22222222-2222-4222-8222-222222222201',
    'Farm Eggs',
    'Fresh farm eggs suitable for everyday cooking.',
    '11111111-1111-4111-8111-111111111101',
    'FarmFresh',
    'ACTIVE'
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    'Durum Pasta',
    'Dry durum wheat pasta for family meals.',
    '11111111-1111-4111-8111-111111111102',
    'Nonna',
    'ACTIVE'
  ),
  (
    '22222222-2222-4222-8222-222222222203',
    'Tomato Pasta Sauce',
    'Ready tomato pasta sauce.',
    '11111111-1111-4111-8111-111111111102',
    'Nonna',
    'ACTIVE'
  ),
  (
    '22222222-2222-4222-8222-222222222204',
    'Fresh Milk',
    'Pasteurized full-cream milk.',
    '11111111-1111-4111-8111-111111111101',
    'DairyLand',
    'ACTIVE'
  ),
  (
    '22222222-2222-4222-8222-222222222205',
    'Sandwich Bread',
    'Soft sandwich loaf.',
    '11111111-1111-4111-8111-111111111102',
    'BakeHouse',
    'ACTIVE'
  ),
  (
    '22222222-2222-4222-8222-222222222206',
    'Select Eggs',
    'Higher-grade eggs for quality-sensitive cooking.',
    '11111111-1111-4111-8111-111111111101',
    'SelectFarm',
    'ACTIVE'
  )
on conflict (product_id) do update
set name = excluded.name,
    description = excluded.description,
    category_id = excluded.category_id,
    brand = excluded.brand,
    status = excluded.status,
    updated_at = timezone('utc', now());

-- Deterministic SKU/pack variants with authoritative INR prices (paise).
-- Product refs: eggs=...2201, pasta=...2202, sauce=...2203, milk=...2204, bread=...2205
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
    '33333333-3333-4333-8333-333333333301',
    '22222222-2222-4222-8222-222222222201',
    'FARM-EGGS-2',
    2,
    'pieces',
    1200,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333302',
    '22222222-2222-4222-8222-222222222201',
    'FARM-EGGS-6',
    6,
    'pieces',
    3600,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333303',
    '22222222-2222-4222-8222-222222222202',
    'DURUM-PASTA-500G',
    500,
    'grams',
    8500,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333304',
    '22222222-2222-4222-8222-222222222202',
    'DURUM-PASTA-1KG',
    1000,
    'grams',
    15500,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333305',
    '22222222-2222-4222-8222-222222222203',
    'TOMATO-SAUCE-400G',
    400,
    'grams',
    9900,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333306',
    '22222222-2222-4222-8222-222222222204',
    'FRESH-MILK-1L',
    1,
    'litre',
    6200,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333307',
    '22222222-2222-4222-8222-222222222205',
    'SANDWICH-BREAD-400G',
    400,
    'grams',
    4500,
    'INR',
    'ACTIVE'
  ),
  (
    '33333333-3333-4333-8333-333333333308',
    '22222222-2222-4222-8222-222222222206',
    'SELECT-EGGS-6',
    6,
    'pieces',
    4200,
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

-- Deterministic stock per SKU (inventory availability; not SKU status).
-- SANDWICH-BREAD-400G is deliberately out of stock (available_quantity = 0).
insert into public.stock (sku_id, available_quantity)
values
  ('33333333-3333-4333-8333-333333333301', 48),  -- FARM-EGGS-2 (₹12, good-quality path)
  ('33333333-3333-4333-8333-333333333302', 24),  -- FARM-EGGS-6 (₹36, poor-quality path)
  ('33333333-3333-4333-8333-333333333303', 40),  -- DURUM-PASTA-500G
  ('33333333-3333-4333-8333-333333333304', 20),  -- DURUM-PASTA-1KG
  ('33333333-3333-4333-8333-333333333305', 35),  -- TOMATO-SAUCE-400G
  ('33333333-3333-4333-8333-333333333306', 18),  -- FRESH-MILK-1L
  ('33333333-3333-4333-8333-333333333307', 0),   -- SANDWICH-BREAD-400G (OOS)
  ('33333333-3333-4333-8333-333333333308', 30)   -- SELECT-EGGS-6 (₹42, good-quality 6-pack)
on conflict (sku_id) do update
set available_quantity = excluded.available_quantity,
    updated_at = timezone('utc', now());

-- Deterministic application users for cart ownership tests/demo.
insert into public.app_user (user_id, display_name, currency)
values
  ('44444444-4444-4444-8444-444444444401', 'Demo Shopper', 'INR'),
  ('44444444-4444-4444-8444-444444444402', 'Second Shopper', 'INR')
on conflict (user_id) do update
set display_name = excluded.display_name,
    currency = excluded.currency,
    updated_at = timezone('utc', now());

-- Active carts (no cart items in this step).
insert into public.cart (cart_id, user_id, status)
values
  (
    '55555555-5555-4555-8555-555555555501',
    '44444444-4444-4444-8444-444444444401',
    'OPEN_CART'
  ),
  (
    '55555555-5555-4555-8555-555555555502',
    '44444444-4444-4444-8444-444444444402',
    'OPEN_CART'
  )
on conflict (cart_id) do update
set user_id = excluded.user_id,
    status = excluded.status,
    updated_at = timezone('utc', now());

-- Deterministic Phase 2 mandate fixtures (Doc 10 §4.3).
-- Mandate A: ₹1000 / grocery / ₹300 per item / ACTIVE
-- Mandate B: ₹800 / grocery / ₹300 per item / ACTIVE
-- Mandate C: EXPIRED (authorization must fail later policy steps)
insert into public.mandate (
  mandate_id,
  user_id,
  agent_id,
  max_spend_minor,
  currency,
  max_per_item_minor,
  purpose,
  valid_until,
  status,
  created_at,
  updated_at
)
values
  (
    '77777777-7777-4777-8777-777777777701',
    '44444444-4444-4444-8444-444444444401',
    'agent-001',
    100000,
    'INR',
    30000,
    'Mandate A — ₹1000 grocery ceiling',
    '2026-12-31T23:59:59+00:00',
    'ACTIVE',
    '2026-09-01T00:00:00+00:00',
    '2026-09-01T00:00:00+00:00'
  ),
  (
    '77777777-7777-4777-8777-777777777702',
    '44444444-4444-4444-8444-444444444401',
    'agent-001',
    80000,
    'INR',
    30000,
    'Mandate B — ₹800 grocery ceiling',
    '2026-12-31T23:59:59+00:00',
    'ACTIVE',
    '2026-09-01T00:00:00+00:00',
    '2026-09-01T00:00:00+00:00'
  ),
  (
    '77777777-7777-4777-8777-777777777703',
    '44444444-4444-4444-8444-444444444402',
    'agent-002',
    100000,
    'INR',
    30000,
    'Mandate C — expired fixture',
    '2026-01-01T00:00:00+00:00',
    'EXPIRED',
    '2025-12-01T00:00:00+00:00',
    '2026-01-01T00:00:00+00:00'
  )
on conflict (mandate_id) do update
set user_id = excluded.user_id,
    agent_id = excluded.agent_id,
    max_spend_minor = excluded.max_spend_minor,
    currency = excluded.currency,
    max_per_item_minor = excluded.max_per_item_minor,
    purpose = excluded.purpose,
    valid_until = excluded.valid_until,
    status = excluded.status,
    created_at = excluded.created_at,
    updated_at = timezone('utc', now());

insert into public.mandate_category (mandate_id, category)
values
  ('77777777-7777-4777-8777-777777777701', 'grocery'),
  ('77777777-7777-4777-8777-777777777702', 'grocery'),
  ('77777777-7777-4777-8777-777777777703', 'grocery')
on conflict (mandate_id, category) do nothing;

-- Phase 4 Step 2 — Deterministic quality evidence (Doc 05 / Doc 10).
-- Informational research only — not price/stock/mandate/policy authority.
-- Six-egg canonical scenario:
--   FARM-EGGS-6  ₹36 UNACCEPTABLE (reject when quality material)
--   SELECT-EGGS-6 ₹42 GOOD (feasible alternative)
--   FARM-EGGS-2  ₹12 GOOD × 3 = ₹36 (preferred feasible combination)
-- Sandwich Bread deliberately has no evidence (empty retrieval).
-- One expired milk row exists to verify expiry exclusion from research use.
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
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
    '22222222-2222-4222-8222-222222222201',
    '33333333-3333-4333-8333-333333333302',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:egg-6pack-poor',
    'Repeated poor quality signals for this six-pack; freshness complaints are common.',
    'UNACCEPTABLE',
    0.92,
    '2026-09-01T10:00:00+00:00',
    null,
    '2026-09-01T10:00:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02',
    '22222222-2222-4222-8222-222222222201',
    '33333333-3333-4333-8333-333333333301',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:egg-2pack-good',
    'Consistently positive quality signals for the two-egg pack.',
    'GOOD',
    0.88,
    '2026-09-01T11:00:00+00:00',
    null,
    '2026-09-01T11:00:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03',
    '22222222-2222-4222-8222-222222222206',
    '33333333-3333-4333-8333-333333333308',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:egg-6pack-good',
    'Consistently positive quality signals for this six-pack alternative.',
    'GOOD',
    0.90,
    '2026-09-01T12:00:00+00:00',
    null,
    '2026-09-01T12:00:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04',
    '22222222-2222-4222-8222-222222222204',
    '33333333-3333-4333-8333-333333333306',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:milk-acceptable',
    'Acceptable everyday quality signals with mixed but non-blocking review notes.',
    'ACCEPTABLE',
    0.74,
    '2026-09-02T09:00:00+00:00',
    null,
    '2026-09-02T09:00:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05',
    '22222222-2222-4222-8222-222222222202',
    '33333333-3333-4333-8333-333333333303',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:pasta-premium',
    'Strong positive quality signals relative to standard dry pasta alternatives.',
    'PREMIUM',
    0.91,
    '2026-09-02T10:30:00+00:00',
    null,
    '2026-09-02T10:30:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06',
    '22222222-2222-4222-8222-222222222203',
    '33333333-3333-4333-8333-333333333305',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:sauce-acceptable',
    'Acceptable quality signals for everyday pasta sauce use.',
    'ACCEPTABLE',
    0.70,
    '2026-09-02T11:00:00+00:00',
    null,
    '2026-09-02T11:00:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee07',
    '22222222-2222-4222-8222-222222222202',
    '33333333-3333-4333-8333-333333333304',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:pasta-1kg-good',
    'Generally positive quality signals; confidence is lower than the premium 500g summary.',
    'GOOD',
    0.65,
    '2026-09-02T08:00:00+00:00',
    null,
    '2026-09-02T08:00:00+00:00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee08',
    '22222222-2222-4222-8222-222222222204',
    '33333333-3333-4333-8333-333333333306',
    'SEEDED_REVIEW_SUMMARY',
    'seed:quality:milk-expired',
    'Older review summary retained for expiry-handling tests; not current research evidence.',
    'ACCEPTABLE',
    0.80,
    '2025-01-01T00:00:00+00:00',
    '2025-06-01T00:00:00+00:00',
    '2025-01-01T00:00:00+00:00'
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
