export type {
  FeasibilityContext,
  FeasibilityContextInput,
  FeasibilityResult,
  FulfillmentAssumption,
  FulfillmentAssumptionCode,
  FulfillmentOptions,
  FulfillmentResult,
  OptimizationCandidate,
  OptimizationConstraintEntry,
  OptimizationRejectionReason,
  OptimizationRequirement,
  OptimizationRequirementInput,
  PackCandidateInput,
  PackCombination,
  PackCombinationLine,
  PackOptBounds,
  PackOptimizationContextInput,
  PackQualitySnapshot,
  QualityRankedCombination,
  QualityRankingObjective,
  QualityRankingView,
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

export type {
  EligiblePack,
  IneligiblePack,
  PackOptimizationResult,
} from "./pack-optimization.js";

export type {
  QualityAwareRankingInput,
  QualityAwareRankingResult,
} from "./quality-ranking.js";

export type {
  DealOptimizationInput,
  DealOptimizationResult,
} from "./deal-optimization.js";

export type {
  VoucherDecisionInput,
  OptimizeVoucherDecisionsInput,
  OptimizeVoucherDecisionsResult,
} from "./voucher-decision.js";

export type {
  LoyaltyDecisionInput,
  OptimizeLoyaltyDecisionsInput,
  OptimizeLoyaltyDecisionsResult,
} from "./loyalty-decision.js";

export type {
  BestValueRequirementSlot,
  BestValueInput,
} from "./best-value.js";

export type {
  BestQualityRequirementSlot,
  BestQualityInput,
} from "./best-quality.js";

export type { BasketRecommendationInput } from "./recommendation.js";

/** Phase 0 placeholder retained for scaffold compatibility — prefer domain types above. */
export type OptimizationPlaceholder = {
  module: "optimization";
};
