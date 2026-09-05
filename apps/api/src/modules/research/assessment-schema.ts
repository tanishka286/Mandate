import { z } from "zod";
import {
  evidenceConfidenceSchema,
  evidenceIdSchema,
  productIdSchema,
  qualitySignalSchema,
  skuIdSchema,
  QUALITY_SIGNALS,
  type QualitySignal,
} from "./schema.js";

/**
 * Locked quality ordering (Doc 05 §6.1):
 * UNACCEPTABLE < ACCEPTABLE < GOOD < PREMIUM
 */
export const QUALITY_SIGNAL_RANK: Record<QualitySignal, number> = {
  UNACCEPTABLE: 0,
  ACCEPTABLE: 1,
  GOOD: 2,
  PREMIUM: 3,
};

/**
 * Evidence materiality status for explainability (Phase 4 Step 3).
 * Not a scoring system — structured status for safe downstream use.
 */
export const EVIDENCE_STATUSES = [
  "NONE",
  "SUFFICIENT",
  "WEAK",
  "CONFLICTING",
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const evidenceStatusSchema = z.enum(EVIDENCE_STATUSES);

/**
 * Below this stored confidence, consistent evidence is treated as WEAK /
 * insufficient for a material quality decision.
 */
export const WEAK_CONFIDENCE_THRESHOLD = 0.5;

/**
 * When signals conflict, confidence is reduced by this factor applied to
 * min(stored confidences). Spec does not define a formula; this is the
 * simplest deterministic conservative rule (Doc 05 §6.2 / Doc 12).
 */
export const CONFLICT_CONFIDENCE_FACTOR = 0.5;

export const assessCandidateQualityInputSchema = z
  .object({
    product_id: productIdSchema,
    /** When set, only evidence for this SKU (or product-level null sku) applies. */
    sku_id: skuIdSchema.nullable().optional(),
    /**
     * Optional minimum quality threshold (Doc 05 requirement fulfillment).
     * Compared with locked ordering; never silently lowered.
     */
    minimum_quality: qualitySignalSchema.nullable().optional(),
  })
  .strict();

export type AssessCandidateQualityInput = z.infer<
  typeof assessCandidateQualityInputSchema
>;

/**
 * Structured candidate quality assessment (FR-04 / Doc 05).
 * Interpretation of evidence — not authoritative catalog/price/stock state.
 */
export const candidateQualityAssessmentSchema = z
  .object({
    product_id: productIdSchema,
    sku_id: skuIdSchema.nullable(),
    /**
     * Observed quality signal from current evidence, or null when none.
     * Never invented when evidence is unavailable.
     */
    quality_signal: qualitySignalSchema.nullable(),
    confidence: evidenceConfidenceSchema,
    /** evidence_id values from retrieved current evidence only. */
    evidence_refs: z.array(evidenceIdSchema),
    /** Evidence-backed interpretive conclusion — not a guarantee. */
    assessment: z.string().min(1),
    /** True only when evidence is consistent and strong enough to decide. */
    evidence_sufficient: z.boolean(),
    evidence_status: evidenceStatusSchema,
    /**
     * Whether quality_signal meets minimum_quality when a threshold was supplied.
     * null when no threshold was provided.
     * false when threshold was provided but quality cannot be established.
     */
    meets_minimum_quality: z.boolean().nullable(),
  })
  .strict();

export type CandidateQualityAssessment = z.infer<
  typeof candidateQualityAssessmentSchema
>;

export function qualitySignalRank(signal: QualitySignal): number {
  return QUALITY_SIGNAL_RANK[signal];
}

/**
 * Conservative signal: lowest rank among the set (never the highest).
 */
export function conservativeQualitySignal(
  signals: readonly QualitySignal[],
): QualitySignal {
  if (signals.length === 0) {
    throw new Error("conservativeQualitySignal requires at least one signal");
  }
  let selected: QualitySignal = signals[0]!;
  for (const signal of signals) {
    if (qualitySignalRank(signal) < qualitySignalRank(selected)) {
      selected = signal;
    }
  }
  return selected;
}

export function meetsMinimumQuality(
  observed: QualitySignal | null,
  minimum: QualitySignal,
): boolean {
  if (observed === null) {
    return false;
  }
  return qualitySignalRank(observed) >= qualitySignalRank(minimum);
}

/**
 * Map requirement-style minimum_quality labels to locked QualitySignal.
 * Rejects unknown labels — does not silently lower the threshold.
 */
export function parseMinimumQualityLabel(
  value: string | null | undefined,
): QualitySignal | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if ((QUALITY_SIGNALS as readonly string[]).includes(normalized)) {
    return normalized as QualitySignal;
  }
  throw Object.assign(new Error("Unsupported minimum_quality label"), {
    code: "VALIDATION_ERROR",
    statusCode: 400,
    details: { minimum_quality: value },
  });
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
