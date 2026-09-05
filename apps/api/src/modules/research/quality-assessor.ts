import { parseOrThrow } from "../../shared/validation/index.js";
import {
  CONFLICT_CONFIDENCE_FACTOR,
  WEAK_CONFIDENCE_THRESHOLD,
  candidateQualityAssessmentSchema,
  clampConfidence,
  conservativeQualitySignal,
  meetsMinimumQuality,
  qualitySignalRank,
  type AssessCandidateQualityInput,
  type CandidateQualityAssessment,
  type EvidenceStatus,
} from "./assessment-schema.js";
import {
  assessmentTextOverclaims,
  buildAssessmentPhrase,
  toStructuredEvidenceForAssessment,
  type StructuredEvidenceForAssessment,
} from "./evidence-trust-boundary.js";
import type { QualityEvidence, QualitySignal } from "./schema.js";

/**
 * Deterministic evidence → candidate quality assessment (Phase 4 Steps 3–4).
 *
 * Rules (Doc 05 §6.2 / Doc 12 §7; no spec aggregation formula → conservative):
 * 1. Use only current evidence already filtered by the caller.
 * 2. quality_signal / confidence come ONLY from structured evidence fields
 *    (see evidence-trust-boundary). Summary text is never read here.
 * 3. Evidence summary is opaque data — never executed, never promoted into
 *    quality_signal, confidence, mandate, policy, price, stock, or tools.
 * 4. Consistent signals → shared signal; confidence = min(stored confidences).
 * 5. Conflicting signals → conservative (lowest) signal; confidence =
 *    min(stored) * CONFLICT_CONFIDENCE_FACTOR; evidence_sufficient = false.
 * 6. No evidence → null signal, confidence 0, insufficient.
 * 7. Assessment phrasing must not overclaim relative to evidence strength.
 */
export function assessFromCurrentEvidence(
  input: AssessCandidateQualityInput,
  evidence: readonly QualityEvidence[],
): CandidateQualityAssessment {
  // Drop free-text before any interpretation — summary cannot influence results.
  const structured = evidence.map(toStructuredEvidenceForAssessment);
  return assessFromStructuredEvidence(input, structured);
}

/**
 * Assessment entry that accepts only structured fields (no summary present).
 * Preferred for tests proving free-text cannot cross the authority boundary.
 */
export function assessFromStructuredEvidence(
  input: AssessCandidateQualityInput,
  evidence: readonly StructuredEvidenceForAssessment[],
): CandidateQualityAssessment {
  const skuId = input.sku_id ?? null;
  const refs = evidence
    .map((row) => row.evidence_id)
    .slice()
    .sort((a, b) => a.localeCompare(b));

  const minimum = input.minimum_quality ?? null;

  if (evidence.length === 0) {
    return finalizeAssessment({
      product_id: input.product_id,
      sku_id: skuId,
      quality_signal: null,
      confidence: 0,
      evidence_refs: [],
      evidence_status: "NONE",
      meets_minimum_quality:
        minimum === null ? null : meetsMinimumQuality(null, minimum),
    });
  }

  const signals = evidence.map((row) => row.quality_signal);
  const uniqueSignals = [...new Set(signals)];
  const minConfidence = Math.min(...evidence.map((row) => row.confidence));

  if (uniqueSignals.length > 1) {
    const qualitySignal = conservativeQualitySignal(uniqueSignals);
    const confidence = clampConfidence(
      minConfidence * CONFLICT_CONFIDENCE_FACTOR,
    );
    const conflictingSignals = uniqueSignals
      .slice()
      .sort((a, b) => qualitySignalRank(a) - qualitySignalRank(b));

    return finalizeAssessment({
      product_id: input.product_id,
      sku_id: skuId,
      quality_signal: qualitySignal,
      confidence,
      evidence_refs: refs,
      evidence_status: "CONFLICTING",
      conflictingSignals,
      meets_minimum_quality:
        minimum === null ? null : meetsMinimumQuality(qualitySignal, minimum),
    });
  }

  const qualitySignal = uniqueSignals[0] as QualitySignal;
  const confidence = clampConfidence(minConfidence);
  const weak = confidence < WEAK_CONFIDENCE_THRESHOLD;
  const evidenceStatus: EvidenceStatus = weak ? "WEAK" : "SUFFICIENT";

  return finalizeAssessment({
    product_id: input.product_id,
    sku_id: skuId,
    quality_signal: qualitySignal,
    confidence,
    evidence_refs: refs,
    evidence_status: evidenceStatus,
    meets_minimum_quality:
      minimum === null ? null : meetsMinimumQuality(qualitySignal, minimum),
  });
}

function finalizeAssessment(args: {
  product_id: string;
  sku_id: string | null;
  quality_signal: QualitySignal | null;
  confidence: number;
  evidence_refs: string[];
  evidence_status: EvidenceStatus;
  conflictingSignals?: readonly QualitySignal[];
  meets_minimum_quality: boolean | null;
}): CandidateQualityAssessment {
  const assessment = buildAssessmentPhrase({
    evidenceStatus: args.evidence_status,
    qualitySignal: args.quality_signal,
    conflictingSignals: args.conflictingSignals,
  });

  if (assessmentTextOverclaims(assessment)) {
    throw new Error(
      "Assessment phrasing exceeded evidence strength (internal invariant)",
    );
  }

  return parseOrThrow(candidateQualityAssessmentSchema, {
    product_id: args.product_id,
    sku_id: args.sku_id,
    quality_signal: args.quality_signal,
    confidence: args.confidence,
    evidence_refs: args.evidence_refs,
    assessment,
    evidence_sufficient:
      args.evidence_status === "SUFFICIENT",
    evidence_status: args.evidence_status,
    meets_minimum_quality: args.meets_minimum_quality,
  });
}

/**
 * Select evidence applicable to a candidate.
 * - Always requires matching product_id.
 * - When sku_id is set: include matching SKU rows and product-level (null sku) rows;
 *   exclude other SKUs on the same product.
 * - When sku_id is unset: include all product evidence.
 */
export function selectEvidenceForCandidate(
  productId: string,
  skuId: string | null | undefined,
  evidence: readonly QualityEvidence[],
): QualityEvidence[] {
  const forProduct = evidence.filter((row) => row.product_id === productId);
  if (skuId === null || skuId === undefined) {
    return forProduct.slice();
  }
  return forProduct.filter(
    (row) => row.sku_id === null || row.sku_id === skuId,
  );
}
