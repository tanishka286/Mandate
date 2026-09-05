/**
 * Optimization module — Phase 5 Steps 1–9.
 *
 * Step 1: feasibility + fulfillment
 * Step 2: pack combinations
 * Step 3: quality-aware ranking primitives
 * Step 4: ordinary merchant deal economics
 * Step 5: smart voucher decision
 * Step 6: loyalty reward decision
 * Step 7: Best Value basket generation
 * Step 8: Best Quality basket generation
 * Step 9: basket comparison & recommendation metadata
 */

export { OptimizationController } from "./controller.js";
export { OptimizationService } from "./service.js";
export { OptimizationRepository } from "./repository.js";
export { optimizationRouter } from "./routes.js";

export {
  OPTIMIZATION_CURRENCY,
  OPTIMIZATION_REJECTION_REASONS,
  FULFILLMENT_ASSUMPTION_CODES,
  PACK_OPT_BOUNDS,
  QUALITY_RANKING_OBJECTIVES,
  MERCHANT_DEAL_TYPES,
  DEAL_AUTHORITY_SOURCES,
  optimizationRejectionReasonSchema,
  optimizationConstraintEntrySchema,
  optimizationRequirementSchema,
  normalizeOptimizationRequirement,
  optimizationCandidateSchema,
  feasibilityContextSchema,
  feasibilityResultSchema,
  fulfillmentAssumptionSchema,
  fulfillmentOptionsSchema,
  fulfillmentResultSchema,
  packQualitySnapshotSchema,
  packCandidateInputSchema,
  packCombinationLineSchema,
  packCombinationSchema,
  packOptimizationContextSchema,
  qualityRankingObjectiveSchema,
  qualityRankingViewSchema,
  qualityRankedCombinationSchema,
  merchantDealTypeSchema,
  dealAuthoritySourceSchema,
  merchantDealAttachmentSchema,
  effectiveCostPerRequiredUnitSchema,
  dealEconomicsSchema,
  dealRankedCombinationSchema,
  VOUCHER_DECISION_STATES,
  VOUCHER_VALIDITY_STATES,
  VOUCHER_ELIGIBILITY_STATES,
  VOUCHER_AUTHORITY_SOURCES,
  FUTURE_VALUE_STATUSES,
  VOUCHER_DECISION_REASONS,
  voucherDecisionStateSchema,
  voucherValidityStateSchema,
  voucherEligibilityStateSchema,
  voucherAuthoritySourceSchema,
  futureValueStatusSchema,
  voucherDecisionReasonSchema,
  authoritativeVoucherSchema,
  voucherBasketContextSchema,
  voucherDecisionEconomicsSchema,
  voucherDecisionResultSchema,
  LOYALTY_DECISION_STATES,
  LOYALTY_VALIDITY_STATES,
  LOYALTY_ELIGIBILITY_STATES,
  LOYALTY_AUTHORITY_SOURCES,
  LOYALTY_VALUE_KINDS,
  LOYALTY_DECISION_REASONS,
  loyaltyDecisionStateSchema,
  loyaltyValidityStateSchema,
  loyaltyEligibilityStateSchema,
  loyaltyAuthoritySourceSchema,
  loyaltyValueKindSchema,
  loyaltyDecisionReasonSchema,
  authoritativeLoyaltyRewardSchema,
  loyaltyBasketContextSchema,
  loyaltyDecisionEconomicsSchema,
  loyaltyDecisionResultSchema,
  BEST_VALUE_BOUNDS,
  BASKET_TYPES,
  BEST_VALUE_EXPLANATION_REASONS,
  basketTypeSchema,
  bestValueExplanationReasonSchema,
  bestValueBasketItemSchema,
  bestValueIncentiveSummarySchema,
  bestValueExplanationSchema,
  bestValueBasketSchema,
  bestValueRequirementFailureSchema,
  bestValueInfeasibilitySchema,
  bestValueResultSchema,
  BEST_QUALITY_BOUNDS,
  BEST_QUALITY_EXPLANATION_REASONS,
  bestQualityExplanationReasonSchema,
  bestQualityExplanationSchema,
  bestQualityBasketSchema,
  bestQualityInfeasibilitySchema,
  bestQualityResultSchema,
  EXPLICIT_BASKET_PREFERENCES,
  RECOMMENDATION_REASON_CODES,
  RECOMMENDATION_DECISION_CLARITY,
  explicitBasketPreferenceSchema,
  recommendationReasonCodeSchema,
  recommendationDecisionClaritySchema,
  recommendationIncentiveViewSchema,
  recommendationTradeoffSchema,
  basketRecommendationSuccessSchema,
  basketRecommendationFailureSchema,
  basketRecommendationResultSchema,
} from "./schema.js";

export type {
  OptimizationRejectionReason,
  OptimizationConstraintEntry,
  OptimizationRequirement,
  OptimizationRequirementInput,
  OptimizationCandidate,
  FeasibilityContext,
  FeasibilityContextInput,
  FeasibilityResult,
  FulfillmentAssumptionCode,
  FulfillmentAssumption,
  FulfillmentOptions,
  FulfillmentResult,
  PackOptBounds,
  PackQualitySnapshot,
  PackCandidateInput,
  PackCombinationLine,
  PackCombination,
  PackOptimizationContextInput,
  QualityRankingObjective,
  QualityRankingView,
  QualityRankedCombination,
  MerchantDealType,
  DealAuthoritySource,
  MerchantDealAttachment,
  MerchantDealAttachmentInput,
  EffectiveCostPerRequiredUnit,
  DealEconomics,
  DealRankedCombination,
  VoucherDecisionState,
  VoucherValidityState,
  VoucherEligibilityState,
  VoucherAuthoritySource,
  FutureValueStatus,
  VoucherDecisionReason,
  AuthoritativeVoucher,
  AuthoritativeVoucherInput,
  VoucherBasketContext,
  VoucherBasketContextInput,
  VoucherDecisionEconomics,
  VoucherDecisionResult,
  LoyaltyDecisionState,
  LoyaltyValidityState,
  LoyaltyEligibilityState,
  LoyaltyAuthoritySource,
  LoyaltyValueKind,
  LoyaltyDecisionReason,
  AuthoritativeLoyaltyReward,
  AuthoritativeLoyaltyRewardInput,
  LoyaltyBasketContext,
  LoyaltyBasketContextInput,
  LoyaltyDecisionEconomics,
  LoyaltyDecisionResult,
  BestValueBounds,
  BasketType,
  BestValueExplanationReason,
  BestValueBasketItem,
  BestValueIncentiveSummary,
  BestValueExplanation,
  BestValueBasket,
  BestValueRequirementFailure,
  BestValueInfeasibility,
  BestValueResult,
  BestQualityBounds,
  BestQualityExplanationReason,
  BestQualityExplanation,
  BestQualityBasket,
  BestQualityInfeasibility,
  BestQualityResult,
  ExplicitBasketPreference,
  RecommendationReasonCode,
  RecommendationDecisionClarity,
  RecommendationIncentiveView,
  RecommendationTradeoff,
  BasketRecommendationSuccess,
  BasketRecommendationFailure,
  BasketRecommendationResult,
} from "./schema.js";

export {
  parseOptimizationConstraints,
  evaluateCandidateFeasibility,
  filterFeasibleCandidates,
  isValidPurchaseQuantity,
  evaluateProposedQuantityOrReject,
} from "./feasibility.js";

export type { FilteredCandidates } from "./feasibility.js";

export {
  candidateMatchesRequirementItem,
  evaluateUnitCompatibility,
  evaluateRequirementFulfillment,
  evaluateCandidateForRequirement,
} from "./fulfillment.js";

export {
  evaluateEligiblePack,
  comparePackCombinations,
  optimizePackCombinations,
  toPackCandidateInput,
} from "./pack-optimization.js";

export type {
  EligiblePack,
  IneligiblePack,
  PackOptimizationResult,
} from "./pack-optimization.js";

export {
  QUALITY_SIGNAL_RANK,
  toQualityRank,
  normalizeQualityRankingView,
  qualityViewFromPackCombination,
  qualityViewFromSnapshot,
  evaluateHardMinimumQuality,
  compareBestValueCombinations,
  compareBestQualityCombinations,
  compareByObjective,
  rankQualityAwareCombinations,
} from "./quality-ranking.js";

export type {
  QualityAwareRankingInput,
  QualityAwareRankingResult,
} from "./quality-ranking.js";

export {
  assertNoIncentiveFields,
  resolveRealizedDealBenefit,
  effectiveCostPerRequiredUnit,
  compareEffectiveCostPerRequiredUnit,
  evaluateDealEconomics,
  compareDealBestValue,
  compareDealBestQuality,
  optimizeDeals,
} from "./deal-optimization.js";

export type {
  DealOptimizationInput,
  DealOptimizationResult,
} from "./deal-optimization.js";

export {
  resolveImmediateVoucherBenefit,
  isWeakImmediateBenefitUnderUncertainty,
  evaluateVoucherDecision,
  selectVoucherDecision,
  optimizeVoucherDecisions,
} from "./voucher-decision.js";

export type {
  VoucherDecisionInput,
  OptimizeVoucherDecisionsInput,
  OptimizeVoucherDecisionsResult,
} from "./voucher-decision.js";

export {
  resolveImmediateLoyaltyBenefit,
  evaluateLoyaltyDecision,
  selectLoyaltyDecision,
  optimizeLoyaltyDecisions,
} from "./loyalty-decision.js";

export type {
  LoyaltyDecisionInput,
  OptimizeLoyaltyDecisionsInput,
  OptimizeLoyaltyDecisionsResult,
} from "./loyalty-decision.js";

export {
  stage1CandidatesPerRequirement,
  compareBestValueBaskets,
  generateBestValueBasket,
} from "./best-value.js";

export type {
  BestValueRequirementSlot,
  BestValueInput,
} from "./best-value.js";

export {
  evidenceSupportsMaterialQualityClaim,
  rankingQualityRankForBestQuality,
  hasMaterialQualityImprovement,
  compareBestQualityBaskets,
  generateBestQualityBasket,
} from "./best-quality.js";

export type {
  BestQualityRequirementSlot,
  BestQualityInput,
} from "./best-quality.js";

export { deriveBasketId, recommendBasket } from "./recommendation.js";

export type { BasketRecommendationInput } from "./recommendation.js";
