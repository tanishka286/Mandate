import type {
  AssessCandidateQualityInput,
  CandidateQualityAssessment,
  EvidenceStatus,
} from "./assessment-schema.js";
import type {
  EvidenceSourceType,
  ProductEvidenceItem,
  ProductEvidenceList,
  ProductEvidenceParams,
  QualityEvidence,
  QualitySignal,
} from "./schema.js";

export type {
  AssessCandidateQualityInput,
  CandidateQualityAssessment,
  EvidenceSourceType,
  EvidenceStatus,
  ProductEvidenceItem,
  ProductEvidenceList,
  ProductEvidenceParams,
  QualityEvidence,
  QualitySignal,
};

/** Row shape returned from Supabase `quality_evidence` table. */
export interface QualityEvidenceRow {
  evidence_id: string;
  product_id: string;
  sku_id: string | null;
  source_type: string;
  source_reference: string | null;
  summary: string;
  quality_signal: string;
  /** Postgres NUMERIC may arrive as string. */
  confidence: number | string;
  captured_at: string;
  expires_at: string | null;
  created_at: string;
}
