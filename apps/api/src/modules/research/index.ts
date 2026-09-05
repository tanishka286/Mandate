export { ResearchController } from "./controller.js";
export { ResearchService } from "./service.js";
export { ResearchRepository } from "./repository.js";
export {
  researchRouter,
  registerProductEvidenceRoutes,
} from "./routes.js";
export {
  assessFromCurrentEvidence,
  assessFromStructuredEvidence,
  selectEvidenceForCandidate,
} from "./quality-assessor.js";
export {
  assessmentTextOverclaims,
  buildAssessmentPhrase,
  serializeEvidenceSummaryAsData,
  toAgentEvidenceView,
  toStructuredEvidenceForAssessment,
} from "./evidence-trust-boundary.js";
export type {
  AgentEvidenceView,
  StructuredEvidenceForAssessment,
} from "./evidence-trust-boundary.js";
export {
  CONFLICT_CONFIDENCE_FACTOR,
  EVIDENCE_STATUSES,
  QUALITY_SIGNAL_RANK,
  WEAK_CONFIDENCE_THRESHOLD,
  assessCandidateQualityInputSchema,
  candidateQualityAssessmentSchema,
  clampConfidence,
  conservativeQualitySignal,
  evidenceStatusSchema,
  meetsMinimumQuality,
  parseMinimumQualityLabel,
  qualitySignalRank,
} from "./assessment-schema.js";
export {
  EVIDENCE_SOURCE_TYPES,
  QUALITY_SIGNALS,
  evidenceConfidenceSchema,
  evidenceIdSchema,
  evidenceSourceTypeSchema,
  evidenceSummarySchema,
  isCurrentEvidence,
  productEvidenceItemSchema,
  productEvidenceListSchema,
  productEvidenceParamsSchema,
  productIdSchema,
  qualityEvidenceSchema,
  qualitySignalSchema,
  skuIdSchema,
  sourceReferenceSchema,
} from "./schema.js";
export {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
  SEEDED_QUALITY_EVIDENCE,
  SIX_EGG_SCENARIO,
} from "./seed-fixtures.js";
export type {
  AssessCandidateQualityInput,
  CandidateQualityAssessment,
  EvidenceStatus,
} from "./assessment-schema.js";
export type {
  EvidenceSourceType,
  ProductEvidenceItem,
  ProductEvidenceList,
  ProductEvidenceParams,
  QualityEvidence,
  QualityEvidenceRow,
  QualitySignal,
} from "./types.js";
