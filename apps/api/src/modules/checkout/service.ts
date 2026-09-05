import { randomUUID } from "node:crypto";
import { getSupabaseClient } from "../../config/supabase.js";
import { getEnv } from "../../config/env.js";
import { AppError, isAppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import {
  PaymentsRepository,
  RazorpayServerAdapter,
  buildOrderReceipt,
  buildCheckoutFingerprint,
} from "../payments/index.js";
import { BasketService } from "../basket/service.js";
import {
  PolicyRevalidationService,
  type PolicyRevalidationPort,
} from "../policy/revalidation-service.js";
import { checkoutInputSchema, type ValidatedCheckoutInput } from "./schema.js";
import type { CheckoutResult } from "./types.js";

/**
 * Phase 8 Step 4 — Internal Checkout Service.
 *
 * Orchestrates the trusted pre-payment sequence:
 *
 * USER BASKET SELECTION
 *         ↓
 * FRESH AUTHORITATIVE QUOTE
 *         ↓
 * POLICY REVALIDATION
 *         ↓
 * ALLOW ONLY
 *         ↓
 * RAZORPAY TEST MODE ORDER
 *         ↓
 * APPLICATION ORDER + PAYMENT_PENDING
 *
 * Server-only boundary: callable only by backend application flows.
 * AI cannot create orders or mutate financial states.
 */
export class CheckoutService {
  constructor(
    private readonly paymentsRepository = new PaymentsRepository(),
    private readonly basketService = new BasketService(),
    private readonly policyRevalidationService: PolicyRevalidationPort = new PolicyRevalidationService(),
    private readonly razorpayAdapter = new RazorpayServerAdapter(),
    private readonly db = getSupabaseClient(),
  ) {}

  async checkout(rawInput: unknown): Promise<CheckoutResult> {
    // -------------------------------------------------------------------------
    // STEP 1 — Authenticate caller & validate input
    // -------------------------------------------------------------------------
    const input = parseOrThrow(
      checkoutInputSchema,
      rawInput,
    ) as ValidatedCheckoutInput;

    if (!input.user_id) {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: "Authentication required for checkout",
        statusCode: 401,
      });
    }

    const idempotencyKey = input.idempotency_key.trim();

    // -------------------------------------------------------------------------
    // STEP 2 & 3 — Resolve idempotency record
    // -------------------------------------------------------------------------
    const existingIdempotency =
      await this.paymentsRepository.findCheckoutIdempotency(
        input.user_id,
        idempotencyKey,
      );

    if (existingIdempotency) {
      if (existingIdempotency.response_json) {
        const savedResponse =
          existingIdempotency.response_json as unknown as CheckoutResult;

        // Check whether this request matches the saved authorization identity
        const expectedFingerprint = buildCheckoutFingerprint({
          selection_id: input.selection_id,
          policy_decision_id: input.policy_decision_id,
          quote_version: savedResponse.quote_version,
          final_payable_minor: savedResponse.amount_minor,
        });

        if (existingIdempotency.request_fingerprint !== expectedFingerprint) {
          throw new AppError({
            code: ErrorCodes.IDEMPOTENCY_CONFLICT,
            message:
              "Idempotency-Key was reused with a materially different checkout request.",
            statusCode: 409,
            details: {
              existing_order_id: existingIdempotency.order_id,
              idempotency_key: idempotencyKey,
            },
          });
        }

        // Same idempotency key + same request => return identical logical result
        return savedResponse;
      }
    }

    // -------------------------------------------------------------------------
    // STEP 4 — Load selection from authoritative backend state
    // -------------------------------------------------------------------------
    const { data: selection, error: selectionError } = await this.db
      .from("basket_selection")
      .select(
        "selection_id, session_id, basket_id, user_id, selection_source, selected_at, superseded_at",
      )
      .eq("selection_id", input.selection_id)
      .maybeSingle();

    if (selectionError) {
      throw mapDatabaseError(selectionError, "Failed to load basket selection");
    }

    if (!selection) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Basket selection not found",
        statusCode: 404,
        details: { selection_id: input.selection_id },
      });
    }

    // Cross-user ownership protection
    if (selection.user_id !== input.user_id) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Basket selection does not belong to authenticated user",
        statusCode: 403,
      });
    }

    if (input.session_id && selection.session_id !== input.session_id) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Basket selection does not belong to current session",
        statusCode: 403,
      });
    }

    const sessionId = input.session_id ?? selection.session_id;

    if (selection.superseded_at !== null) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: "Basket selection has been superseded and is no longer valid",
        statusCode: 409,
        details: {
          selection_id: input.selection_id,
          superseded_at: selection.superseded_at,
        },
      });
    }

    // Verify basket is CURRENT and owned
    const { data: basket, error: basketError } = await this.db
      .from("basket")
      .select("basket_id, session_id, user_id, status, state_version")
      .eq("basket_id", selection.basket_id)
      .maybeSingle();

    if (basketError) {
      throw mapDatabaseError(basketError, "Failed to load basket");
    }

    if (!basket) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Referenced basket not found",
        statusCode: 404,
        details: { basket_id: selection.basket_id },
      });
    }

    if (basket.user_id !== input.user_id || basket.session_id !== sessionId) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Basket does not belong to authenticated user/session",
        statusCode: 403,
      });
    }

    if (basket.status !== "CURRENT") {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: "Referenced basket is no longer CURRENT",
        statusCode: 409,
        details: { basket_id: basket.basket_id, status: basket.status },
      });
    }

    // -------------------------------------------------------------------------
    // STEP 5 — Load referenced mandate and policy context
    // -------------------------------------------------------------------------
    const { data: previousPolicyDecision, error: policyError } = await this.db
      .from("policy_decision")
      .select("policy_decision_id, mandate_id, basket_id, user_id, decision")
      .eq("policy_decision_id", input.policy_decision_id)
      .maybeSingle();

    if (policyError) {
      throw mapDatabaseError(policyError, "Failed to load policy decision context");
    }

    if (!previousPolicyDecision) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Referenced policy decision not found",
        statusCode: 404,
        details: { policy_decision_id: input.policy_decision_id },
      });
    }

    if (previousPolicyDecision.user_id !== input.user_id) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Policy decision does not belong to authenticated user",
        statusCode: 403,
      });
    }

    if (previousPolicyDecision.basket_id !== selection.basket_id) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Policy decision is not associated with the selected basket",
        statusCode: 400,
        details: {
          input_basket_id: selection.basket_id,
          policy_basket_id: previousPolicyDecision.basket_id,
        },
      });
    }

    // -------------------------------------------------------------------------
    // STEP 6 — Fresh Quote
    // -------------------------------------------------------------------------
    const freshQuote = await this.basketService.createFreshQuote(
      input.user_id,
      selection.basket_id,
      {},
      input.request_id,
    );

    if (!freshQuote || !freshQuote.quote_version) {
      throw new AppError({
        code: "AMOUNT_CALCULATION_FAILED",
        message: "Authoritative quote is unavailable for checkout revalidation",
        statusCode: 422,
      });
    }

    // -------------------------------------------------------------------------
    // STEP 7 — Policy Revalidation
    // -------------------------------------------------------------------------
    const revalRequestId = input.request_id ?? `req-${randomUUID()}`;
    const revalIdempotencyKey = `reval-${idempotencyKey}-${freshQuote.quote_version}`;

    const policyResult = await this.policyRevalidationService.revalidate({
      user_id: input.user_id,
      mandate_id: previousPolicyDecision.mandate_id,
      basket_id: selection.basket_id,
      request_id: revalRequestId,
      idempotency_key: revalIdempotencyKey,
      quote_version: freshQuote.quote_version,
    });

    // -------------------------------------------------------------------------
    // STEP 8 — Require ALLOW
    // -------------------------------------------------------------------------
    if (policyResult.decision === "DENY") {
      const reason = policyResult.reason_code ?? "POLICY_DENIED";
      throw new AppError({
        code: reason,
        message:
          policyResult.message ??
          "Policy evaluation denied the checkout authorization request.",
        statusCode: 422,
        details: {
          decision: "DENY",
          reason_code: reason,
          policy_decision_id: policyResult.policy_decision_id,
          final_payable_minor: policyResult.final_payable_minor,
          max_spend_minor: policyResult.max_spend_minor,
          recoverable: policyResult.recoverable,
        },
      });
    }

    if (policyResult.decision !== "ALLOW") {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Unexpected policy evaluation outcome",
        statusCode: 500,
      });
    }

    // -------------------------------------------------------------------------
    // STEP 9 — Create Razorpay Test Mode Order (authoritative amount only)
    // -------------------------------------------------------------------------
    const orderId = randomUUID();
    const receipt = buildOrderReceipt(orderId);

    const razorpayOrder = await this.razorpayAdapter.createRazorpayOrder({
      amount_minor: policyResult.final_payable_minor,
      currency: "INR",
      receipt,
    });

    // -------------------------------------------------------------------------
    // STEP 10 — Atomic Local Persistence (Phase 8 Step 4A)
    // Order + Payment + Idempotency committed in ONE database transaction
    // -------------------------------------------------------------------------
    const fingerprint = buildCheckoutFingerprint({
      selection_id: input.selection_id,
      policy_decision_id: input.policy_decision_id,
      quote_version: freshQuote.quote_version,
      final_payable_minor: policyResult.final_payable_minor,
    });

    const result: CheckoutResult = {
      order_id: orderId,
      razorpay_order_id: razorpayOrder.razorpay_order_id,
      amount_minor: policyResult.final_payable_minor,
      currency: "INR",
      razorpay_key_id: getEnv().RAZORPAY_KEY_ID,
      status: "PAYMENT_PENDING",
      policy_decision_id: policyResult.policy_decision_id,
      quote_version: freshQuote.quote_version,
      request_id: input.request_id ?? revalRequestId,
    };

    try {
      const persisted =
        await this.paymentsRepository.createCheckoutPersistenceAtomic({
          order_id: orderId,
          user_id: input.user_id,
          session_id: sessionId,
          mandate_id: policyResult.mandate_id,
          basket_id: policyResult.basket_id,
          policy_decision_id: policyResult.policy_decision_id,
          gross_amount_minor: policyResult.gross_amount_minor,
          discount_amount_minor: policyResult.discount_amount_minor,
          final_payable_minor: policyResult.final_payable_minor,
          payment_amount_minor: policyResult.final_payable_minor,
          idempotency_key: idempotencyKey,
          request_fingerprint: fingerprint,
          response_json: result as unknown as Record<string, unknown>,
          razorpay_order_id: razorpayOrder.razorpay_order_id,
        });

      if (persisted.replayed && persisted.idempotency.response_json) {
        return persisted.idempotency.response_json as unknown as CheckoutResult;
      }
    } catch (persistenceError) {
      if (
        isAppError(persistenceError) &&
        persistenceError.code === ErrorCodes.IDEMPOTENCY_CONFLICT
      ) {
        throw persistenceError;
      }
      throw new AppError({
        code: "PAYMENT_PERSISTENCE_FAILED",
        message:
          "Checkout persistence failed after provider order creation. Reconciliation required.",
        statusCode: 500,
        details: {
          order_id: orderId,
          razorpay_order_id: razorpayOrder.razorpay_order_id,
          error: isAppError(persistenceError)
            ? persistenceError.message
            : String(persistenceError),
        },
      });
    }

    return result;
  }
}
