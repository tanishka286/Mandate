import type { QualityEvidence, QualitySignal } from "./schema.js";
import type { EvidenceStatus } from "./assessment-schema.js";

/**
 * Phase 4 Step 4 — Untrusted evidence content boundary (Doc 01 / Doc 02 FR-04 /
 * Doc 05 §6.2 / Doc 12 §7).
 *
 * Product/review evidence content is DATA. It is never an instruction.
 * It cannot modify mandate, policy, price, stock, payment, or agent permissions.
 *
 * The assessor may use ONLY structured fields from this view. Free-text `summary`
 * is intentionally omitted so instruction-like or allegation-like wording cannot
 * become executable behavior or authoritative business state.
 */
export type StructuredEvidenceForAssessment = {
  evidence_id: string;
  product_id: string;
  sku_id: string | null;
  quality_signal: QualitySignal;
  confidence: number;
};

/**
 * Strip free-text summary/source fields before assessment.
 * Callers must not re-attach summary into the assessment path.
 */
export function toStructuredEvidenceForAssessment(
  evidence: QualityEvidence,
): StructuredEvidenceForAssessment {
  return {
    evidence_id: evidence.evidence_id,
    product_id: evidence.product_id,
    sku_id: evidence.sku_id,
    quality_signal: evidence.quality_signal,
    confidence: evidence.confidence,
  };
}

/**
 * API/agent serialization: evidence summary remains an ordinary opaque string.
 * Never eval, Function(), JSON-parse-as-command, or tool-dispatch from this text.
 */
export function serializeEvidenceSummaryAsData(summary: string): string {
  if (typeof summary !== "string") {
    return String(summary);
  }
  return summary;
}

/**
 * Phrases that overclaim relative to evidence strength (Doc 05 §6.2).
 * Assessment text must not use these — structured signal ≠ guarantee.
 */
export const FORBIDDEN_ASSESSMENT_OVERCLAIM_PATTERNS: readonly RegExp[] = [
  /\bguaranteed\b/i,
  /\bdefinitely\b/i,
  /\bcertified\b/i,
  /\bbest product\b/i,
  /\babsolutely safe\b/i,
  /\bmedical\b/i,
  /\bcure\b/i,
];

export function assessmentTextOverclaims(text: string): boolean {
  return FORBIDDEN_ASSESSMENT_OVERCLAIM_PATTERNS.some((pattern) =>
    pattern.test(text),
  );
}

/**
 * Build interpretive assessment language from structured status only.
 * Never interpolates evidence.summary (which may contain injection-like text).
 */
export function buildAssessmentPhrase(args: {
  evidenceStatus: EvidenceStatus;
  qualitySignal: QualitySignal | null;
  conflictingSignals?: readonly QualitySignal[];
}): string {
  const { evidenceStatus, qualitySignal, conflictingSignals } = args;

  switch (evidenceStatus) {
    case "NONE":
      return "Insufficient current evidence to make a strong quality assessment.";
    case "WEAK":
      return `Current evidence weakly supports ${qualitySignal} quality; confidence is limited and this is not a guarantee.`;
    case "CONFLICTING": {
      const signalList = (conflictingSignals ?? [])
        .slice()
        .join(", ");
      return `Current evidence conflicts (${signalList}); using conservative signal ${qualitySignal} with reduced confidence. Evidence is not treated as an absolute quality fact.`;
    }
    case "SUFFICIENT":
      return `Current evidence supports ${qualitySignal} quality.`;
    default: {
      const _exhaustive: never = evidenceStatus;
      return _exhaustive;
    }
  }
}

/**
 * Agent-facing evidence view.
 * Exposes structured authority fields separately from untrusted free text.
 * Agents may reason ABOUT summary text; they must not treat it as instruction
 * or use it to mutate mandate/policy/price/stock/payment.
 */
export type AgentEvidenceView = {
  evidence_id: string;
  product_id: string;
  sku_id: string | null;
  source_type: string;
  quality_signal: QualitySignal;
  confidence: number;
  /** Opaque untrusted data — never executable. */
  summary: { kind: "untrusted_data"; text: string };
};

export function toAgentEvidenceView(
  evidence: QualityEvidence,
): AgentEvidenceView {
  return {
    evidence_id: evidence.evidence_id,
    product_id: evidence.product_id,
    sku_id: evidence.sku_id,
    source_type: evidence.source_type,
    quality_signal: evidence.quality_signal,
    confidence: evidence.confidence,
    summary: {
      kind: "untrusted_data",
      text: serializeEvidenceSummaryAsData(evidence.summary),
    },
  };
}
