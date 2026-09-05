-- Phase 4 Step 1 — Product Evidence (quality_evidence) persistence foundation
-- Depends on Phase 1 product + sku.
-- Does NOT implement evidence retrieval HTTP, seeded fixtures, optimization,
-- candidate ranking, research crawlers, or AI mutation paths.
-- Evidence is informational research data — never authoritative for price,
-- stock, category, mandate, final payable, or policy authorization.

create table if not exists public.quality_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product (product_id),
  sku_id uuid null references public.sku (sku_id),
  source_type text not null,
  source_reference text null,
  summary text not null,
  quality_signal text not null,
  confidence numeric not null,
  captured_at timestamptz not null default (timezone('utc', now())),
  expires_at timestamptz null,
  created_at timestamptz not null default (timezone('utc', now())),
  constraint quality_evidence_source_type_controlled check (
    source_type in ('SEEDED_REVIEW_SUMMARY')
  ),
  constraint quality_evidence_source_reference_nonempty check (
    source_reference is null
    or char_length(trim(source_reference)) > 0
  ),
  constraint quality_evidence_summary_nonempty check (
    char_length(trim(summary)) > 0
  ),
  constraint quality_evidence_quality_signal_controlled check (
    quality_signal in ('UNACCEPTABLE', 'ACCEPTABLE', 'GOOD', 'PREMIUM')
  ),
  constraint quality_evidence_confidence_range check (
    confidence >= 0 and confidence <= 1
  )
);

create index if not exists quality_evidence_product_id_idx
  on public.quality_evidence (product_id);

create index if not exists quality_evidence_product_id_sku_id_idx
  on public.quality_evidence (product_id, sku_id);

create index if not exists quality_evidence_quality_signal_idx
  on public.quality_evidence (quality_signal);

comment on table public.quality_evidence is
  'Phase 4 product evidence (Doc 07 §11.1). Controlled quality/review research data. '
  'Informational only — does not override catalog price/stock/category, mandate, '
  'final payable, or policy authorization. AI may reference but must not mutate.';

comment on column public.quality_evidence.product_id is
  'Authoritative product identity (FK). Evidence must reference an existing product.';

comment on column public.quality_evidence.sku_id is
  'Optional SKU/pack identity (FK). NULL when evidence applies at product level.';

comment on column public.quality_evidence.source_type is
  'Controlled evidence source. MVP: SEEDED_REVIEW_SUMMARY only (no unrestricted crawler).';

comment on column public.quality_evidence.source_reference is
  'Optional traceability reference for the evidence source.';

comment on column public.quality_evidence.summary is
  'Evidence summary text. Store evidence, not unsupported model allegations.';

comment on column public.quality_evidence.quality_signal is
  'Locked quality levels: UNACCEPTABLE | ACCEPTABLE | GOOD | PREMIUM (Doc 05 §6.1).';

comment on column public.quality_evidence.confidence is
  'Deterministic evidence confidence in [0, 1]. Represents evidence quality — '
  'not invented model certainty. Not authorization.';

comment on column public.quality_evidence.captured_at is
  'UTC timestamp when the evidence was captured.';

comment on column public.quality_evidence.expires_at is
  'Optional UTC expiry. Expired evidence may be excluded from later optimization.';

comment on column public.quality_evidence.created_at is
  'UTC row creation timestamp.';

-- Backend (service role) remains the authorization boundary.
-- AI/agent has no direct write path to quality_evidence.
alter table public.quality_evidence enable row level security;

-- Advance operational phase metadata to Phase 4.
insert into public.schema_meta (key, value)
values ('phase', '4')
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.schema_meta (key, value)
values (
  'phase4_quality_evidence_schema',
  'quality_evidence; quality_signal UNACCEPTABLE|ACCEPTABLE|GOOD|PREMIUM; '
  'source_type SEEDED_REVIEW_SUMMARY; retrieval/seed fixtures deferred'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());
