import { z } from "zod";

/**
 * Locked quality signals (Doc 05 §6.1 / Doc 07 §11.1).
 * Do not invent additional levels.
 */
export const QUALITY_SIGNALS = [
  "UNACCEPTABLE",
  "ACCEPTABLE",
  "GOOD",
  "PREMIUM",
] as const;

export type QualitySignal = (typeof QUALITY_SIGNALS)[number];

export const qualitySignalSchema = z.enum(QUALITY_SIGNALS);

/**
 * Controlled evidence source types (Doc 08 §9.3).
 * MVP uses seeded/controlled evidence — no unrestricted crawler.
 */
export const EVIDENCE_SOURCE_TYPES = ["SEEDED_REVIEW_SUMMARY"] as const;

export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const evidenceSourceTypeSchema = z.enum(EVIDENCE_SOURCE_TYPES);

/** Accepts UTC ISO timestamps from Postgres/Supabase (including fractional seconds). */
const isoUtcTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

export const evidenceIdSchema = z.string().uuid();

/** Authoritative product identity — evidence must reference an existing product. */
export const productIdSchema = z.string().uuid();

/** Optional SKU/pack identity when evidence is pack-specific. */
export const skuIdSchema = z.string().uuid();

/**
 * Deterministic evidence confidence in [0, 1] (Doc 08 example: 0.86).
 * Finite numeric only — rejects NaN and Infinity.
 * Represents evidence quality, not invented model certainty or authorization.
 */
export const evidenceConfidenceSchema = z
  .number({
    invalid_type_error: "confidence must be a number",
  })
  .finite("confidence must be finite")
  .min(0, "confidence must be >= 0")
  .max(1, "confidence must be <= 1");

export const evidenceSummarySchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "summary must not be empty",
  });

/** Optional source traceability reference. */
export const sourceReferenceSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "source_reference must not be empty when provided",
  })
  .nullable();

/**
 * Persisted quality_evidence row shape (Doc 07 §11.1).
 * Informational research data only — not price/stock/category/mandate/
 * final-payable/policy authority.
 */
export const qualityEvidenceSchema = z
  .object({
    evidence_id: evidenceIdSchema,
    product_id: productIdSchema,
    sku_id: skuIdSchema.nullable(),
    source_type: evidenceSourceTypeSchema,
    source_reference: sourceReferenceSchema,
    summary: evidenceSummarySchema,
    quality_signal: qualitySignalSchema,
    confidence: evidenceConfidenceSchema,
    captured_at: isoUtcTimestampSchema,
    expires_at: isoUtcTimestampSchema.nullable(),
    created_at: isoUtcTimestampSchema,
  })
  .strict();

export type QualityEvidence = z.infer<typeof qualityEvidenceSchema>;

/** Path params for GET /products/{product_id}/evidence (Doc 08 §9.3). */
export const productEvidenceParamsSchema = z.object({
  product_id: productIdSchema,
});

export type ProductEvidenceParams = z.infer<typeof productEvidenceParamsSchema>;

/**
 * Public evidence item in the API response (Doc 08 §9.3).
 * Omits internal/research metadata not required by the contract.
 */
export const productEvidenceItemSchema = z
  .object({
    evidence_id: evidenceIdSchema,
    source_type: evidenceSourceTypeSchema,
    summary: evidenceSummarySchema,
    quality_signal: qualitySignalSchema,
    confidence: evidenceConfidenceSchema,
  })
  .strict();

export type ProductEvidenceItem = z.infer<typeof productEvidenceItemSchema>;

export const productEvidenceListSchema = z
  .object({
    evidence: z.array(productEvidenceItemSchema),
  })
  .strict();

export type ProductEvidenceList = z.infer<typeof productEvidenceListSchema>;

/**
 * Evidence is current for research/optimization when expires_at is null
 * or strictly after `now`. Expired rows must not be treated as current.
 */
export function isCurrentEvidence(
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  if (expiresAt === null) {
    return true;
  }
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) {
    return false;
  }
  return expiresMs > now.getTime();
}
