/**
 * Quote module — Phase 5 Step 10 calculator + Phase 7 HTTP persistence via basket.
 *
 * `generateQuote` remains the pure authoritative calculator.
 * HTTP `POST /baskets/{id}/quote` lives in the basket module and persists versions.
 */

export {
  QUOTE_CURRENCY,
  QUOTE_AMOUNT_KIND,
  QUOTE_FAILURE_REASONS,
  QUOTE_INCENTIVE_KINDS,
  QUOTE_INCENTIVE_DECISIONS,
  QUOTE_INCENTIVE_VALIDITY,
  QUOTE_INCENTIVE_ELIGIBILITY,
  quoteCurrencySchema,
  quoteAmountKindSchema,
  quoteFailureReasonSchema,
  quoteIncentiveKindSchema,
  quoteIncentiveDecisionSchema,
  quoteIncentiveValiditySchema,
  quoteIncentiveEligibilitySchema,
  quoteIncentiveInputSchema,
  quoteCatalogSkuSnapshotSchema,
  quoteBasketLineInputSchema,
  untrustedQuoteClaimsSchema,
  quoteCalculationInputSchema,
  quoteLineResultSchema,
  quoteAppliedIncentiveSchema,
  quoteSuccessSchema,
  quoteFailureSchema,
  quoteResultSchema,
} from "./schema.js";

export type {
  QuoteFailureReason,
  QuoteIncentiveKind,
  QuoteIncentiveDecision,
  QuoteIncentiveValidity,
  QuoteIncentiveEligibility,
  QuoteIncentiveInput,
  QuoteCatalogSkuSnapshot,
  QuoteBasketLineInput,
  UntrustedQuoteClaims,
  QuoteCalculationInput,
  QuoteCalculationInputRaw,
  QuoteLineResult,
  QuoteAppliedIncentive,
  QuoteSuccess,
  QuoteFailure,
  QuoteResult,
} from "./schema.js";

export {
  isApplicableCurrentIncentive,
  resolveApplicableIncentiveBenefits,
  deriveQuoteVersion,
  generateQuote,
} from "./quote-generation.js";
