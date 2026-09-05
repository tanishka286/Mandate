/**
 * Deterministic Phase 4 quality evidence seed fixtures (mirrors supabase/seed.sql).
 * Used for reproducible unit/integration assertions — not an alternate seed path.
 */

export const SEED_PRODUCT_IDS = {
  farmEggs: "22222222-2222-4222-8222-222222222201",
  durumPasta: "22222222-2222-4222-8222-222222222202",
  tomatoSauce: "22222222-2222-4222-8222-222222222203",
  freshMilk: "22222222-2222-4222-8222-222222222204",
  sandwichBread: "22222222-2222-4222-8222-222222222205",
  selectEggs: "22222222-2222-4222-8222-222222222206",
} as const;

export const SEED_SKU_IDS = {
  farmEggs2: "33333333-3333-4333-8333-333333333301",
  farmEggs6: "33333333-3333-4333-8333-333333333302",
  durumPasta500g: "33333333-3333-4333-8333-333333333303",
  durumPasta1kg: "33333333-3333-4333-8333-333333333304",
  tomatoSauce400g: "33333333-3333-4333-8333-333333333305",
  freshMilk1l: "33333333-3333-4333-8333-333333333306",
  sandwichBread400g: "33333333-3333-4333-8333-333333333307",
  selectEggs6: "33333333-3333-4333-8333-333333333308",
} as const;

/** Authoritative six-egg scenario prices (INR paise). */
export const SIX_EGG_SCENARIO = {
  poorSixPack: {
    product_id: SEED_PRODUCT_IDS.farmEggs,
    sku_id: SEED_SKU_IDS.farmEggs6,
    sku_code: "FARM-EGGS-6",
    price_minor: 3600,
    quality_signal: "UNACCEPTABLE" as const,
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
    source_reference: "seed:quality:egg-6pack-poor",
  },
  goodSixPack: {
    product_id: SEED_PRODUCT_IDS.selectEggs,
    sku_id: SEED_SKU_IDS.selectEggs6,
    sku_code: "SELECT-EGGS-6",
    price_minor: 4200,
    quality_signal: "GOOD" as const,
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
    source_reference: "seed:quality:egg-6pack-good",
  },
  goodTwoPack: {
    product_id: SEED_PRODUCT_IDS.farmEggs,
    sku_id: SEED_SKU_IDS.farmEggs2,
    sku_code: "FARM-EGGS-2",
    price_minor: 1200,
    quality_signal: "GOOD" as const,
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02",
    source_reference: "seed:quality:egg-2pack-good",
  },
} as const;

export const SEEDED_QUALITY_EVIDENCE = [
  {
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
    product_id: SEED_PRODUCT_IDS.farmEggs,
    sku_id: SEED_SKU_IDS.farmEggs6,
    source_type: "SEEDED_REVIEW_SUMMARY" as const,
    source_reference: "seed:quality:egg-6pack-poor",
    summary:
      "Repeated poor quality signals for this six-pack; freshness complaints are common.",
    quality_signal: "UNACCEPTABLE" as const,
    confidence: 0.92,
    captured_at: "2026-09-01T10:00:00.000Z",
    expires_at: null as string | null,
    created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02",
    product_id: SEED_PRODUCT_IDS.farmEggs,
    sku_id: SEED_SKU_IDS.farmEggs2,
    source_type: "SEEDED_REVIEW_SUMMARY" as const,
    source_reference: "seed:quality:egg-2pack-good",
    summary: "Consistently positive quality signals for the two-egg pack.",
    quality_signal: "GOOD" as const,
    confidence: 0.88,
    captured_at: "2026-09-01T11:00:00.000Z",
    expires_at: null as string | null,
    created_at: "2026-09-01T11:00:00.000Z",
  },
  {
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
    product_id: SEED_PRODUCT_IDS.selectEggs,
    sku_id: SEED_SKU_IDS.selectEggs6,
    source_type: "SEEDED_REVIEW_SUMMARY" as const,
    source_reference: "seed:quality:egg-6pack-good",
    summary:
      "Consistently positive quality signals for this six-pack alternative.",
    quality_signal: "GOOD" as const,
    confidence: 0.90,
    captured_at: "2026-09-01T12:00:00.000Z",
    expires_at: null as string | null,
    created_at: "2026-09-01T12:00:00.000Z",
  },
  {
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04",
    product_id: SEED_PRODUCT_IDS.freshMilk,
    sku_id: SEED_SKU_IDS.freshMilk1l,
    source_type: "SEEDED_REVIEW_SUMMARY" as const,
    source_reference: "seed:quality:milk-acceptable",
    summary:
      "Acceptable everyday quality signals with mixed but non-blocking review notes.",
    quality_signal: "ACCEPTABLE" as const,
    confidence: 0.74,
    captured_at: "2026-09-02T09:00:00.000Z",
    expires_at: null as string | null,
    created_at: "2026-09-02T09:00:00.000Z",
  },
  {
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05",
    product_id: SEED_PRODUCT_IDS.durumPasta,
    sku_id: SEED_SKU_IDS.durumPasta500g,
    source_type: "SEEDED_REVIEW_SUMMARY" as const,
    source_reference: "seed:quality:pasta-premium",
    summary:
      "Strong positive quality signals relative to standard dry pasta alternatives.",
    quality_signal: "PREMIUM" as const,
    confidence: 0.91,
    captured_at: "2026-09-02T10:30:00.000Z",
    expires_at: null as string | null,
    created_at: "2026-09-02T10:30:00.000Z",
  },
  {
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06",
    product_id: SEED_PRODUCT_IDS.tomatoSauce,
    sku_id: SEED_SKU_IDS.tomatoSauce400g,
    source_type: "SEEDED_REVIEW_SUMMARY" as const,
    source_reference: "seed:quality:sauce-acceptable",
    summary: "Acceptable quality signals for everyday pasta sauce use.",
    quality_signal: "ACCEPTABLE" as const,
    confidence: 0.7,
    captured_at: "2026-09-02T11:00:00.000Z",
    expires_at: null as string | null,
    created_at: "2026-09-02T11:00:00.000Z",
  },
  {
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee07",
    product_id: SEED_PRODUCT_IDS.durumPasta,
    sku_id: SEED_SKU_IDS.durumPasta1kg,
    source_type: "SEEDED_REVIEW_SUMMARY" as const,
    source_reference: "seed:quality:pasta-1kg-good",
    summary:
      "Generally positive quality signals; confidence is lower than the premium 500g summary.",
    quality_signal: "GOOD" as const,
    confidence: 0.65,
    captured_at: "2026-09-02T08:00:00.000Z",
    expires_at: null as string | null,
    created_at: "2026-09-02T08:00:00.000Z",
  },
  {
    evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee08",
    product_id: SEED_PRODUCT_IDS.freshMilk,
    sku_id: SEED_SKU_IDS.freshMilk1l,
    source_type: "SEEDED_REVIEW_SUMMARY" as const,
    source_reference: "seed:quality:milk-expired",
    summary:
      "Older review summary retained for expiry-handling tests; not current research evidence.",
    quality_signal: "ACCEPTABLE" as const,
    confidence: 0.8,
    captured_at: "2025-01-01T00:00:00.000Z",
    expires_at: "2025-06-01T00:00:00.000Z",
    created_at: "2025-01-01T00:00:00.000Z",
  },
] as const;
