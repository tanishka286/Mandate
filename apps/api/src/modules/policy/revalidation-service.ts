import { AppError } from "../../shared/errors/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import {
  type QuoteResolutionPort,
} from "./quote-adapter.js";
import { PersistedQuoteAdapter } from "../basket/quote-adapter.js";
import {
  policyRevalidationRequestSchema,
  type PolicyEvaluationResult,
  type PolicyRevalidationRequest,
} from "./schema.js";
import { PolicyService } from "./service.js";

/**
 * Narrow port for pre-payment / immediate pre-checkout policy revalidation
 * (Doc 06 §17). Checkout/payment later call this instead of trusting a prior ALLOW.
 */
export interface PolicyRevalidationPort {
  revalidate(
    rawInput: unknown,
    now?: Date,
  ): Promise<PolicyEvaluationResult>;
}

/**
 * Current-state reload boundary around PolicyService.
 *
 * Sequence (Doc 06):
 * 1. Accept correlation context only (no client financial authority).
 * 2. Resolve CURRENT authoritative quote lines via QuoteResolutionPort.
 * 3. Delegate to PolicyService.evaluate (mandate → category → stock → …
 *    → persist) so rules are never duplicated here.
 * 4. Only a fresh current ALLOW from that evaluation may later permit payment.
 *
 * Idempotency (Step 5 contract):
 * - Retry of the same revalidation attempt: same user + Idempotency-Key +
 *   fingerprint (mandate_id, basket_id, quote_version) → replay.
 * - A later / distinct revalidation (materially changed quote or a new
 *   authorization attempt) must use a new Idempotency-Key (and typically a
 *   fresh quote_version). Reusing a prior key with a changed fingerprint →
 *   IDEMPOTENCY_CONFLICT. This service never treats a prior ALLOW as sufficient
 *   authorization on its own.
 *
 * Phase 7: default quote port resolves persisted basket_quote rows.
 * Payment-order creation remains out of scope (Phase 8).
 */
export class PolicyRevalidationService implements PolicyRevalidationPort {
  constructor(
    private readonly policyService = new PolicyService(),
    private readonly quotes: QuoteResolutionPort = new PersistedQuoteAdapter(),
  ) {}

  async revalidate(
    rawInput: unknown,
    now: Date = new Date(),
  ): Promise<PolicyEvaluationResult> {
    const input = parseOrThrow(
      policyRevalidationRequestSchema,
      rawInput,
    ) as PolicyRevalidationRequest;

    // Always load current quote authority — never reuse a prior final_payable
    // or invent lines. Prior ALLOW is irrelevant at this boundary.
    const quote = await this.quotes.resolve({
      user_id: input.user_id,
      basket_id: input.basket_id,
      quote_version: input.quote_version,
    });

    if (!quote || quote.lines.length === 0) {
      throw new AppError({
        code: "AMOUNT_CALCULATION_FAILED",
        message: "Authoritative quote is unavailable for policy revalidation.",
        statusCode: 422,
        details: {
          basket_id: input.basket_id,
          quote_version: input.quote_version,
          recoverable: false,
        },
      });
    }

    // Delegate every authorization rule to PolicyService (no duplicated logic).
    return this.policyService.evaluate(
      {
        user_id: input.user_id,
        mandate_id: input.mandate_id,
        basket_id: input.basket_id,
        request_id: input.request_id,
        idempotency_key: input.idempotency_key.trim(),
        quote_version: input.quote_version,
        lines: quote.lines,
        claimed_incentive_ids: quote.claimed_incentive_ids,
      },
      now,
    );
  }
}
