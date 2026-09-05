import { AppError, isAppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import {
  calculateLineAmountMinor,
  calculateCartPricing,
} from "../cart/pricing.js";
import { MandateService } from "../mandate/service.js";
import type { MandateWithCategories } from "../mandate/schema.js";
import { FailClosedIncentiveAdapter } from "./incentive-adapter.js";
import { SupabasePolicyCatalogAdapter } from "./catalog-adapter.js";
import { buildPolicyRequestFingerprint } from "./fingerprint.js";
import type {
  AuthoritativeSkuSnapshot,
  IncentivePort,
  PolicyCatalogPort,
} from "./ports.js";
import {
  PolicyRepository,
  isUniqueConstraintConflict,
} from "./repository.js";
import {
  POLICY_VERSION,
  policyEvaluateRequestSchema,
  policyEvaluationResultSchema,
  type PolicyEvaluateRequest,
  type PolicyEvaluationResult,
  type PolicyReasonCode,
} from "./schema.js";
import type { PolicyDecisionRow } from "./types.js";

const DENY_MESSAGES: Record<PolicyReasonCode, string> = {
  MANDATE_INVALID: "Mandate is missing, inactive, expired, or unauthorized.",
  CATEGORY_NOT_ALLOWED: "One or more items are outside allowed categories.",
  STOCK_UNAVAILABLE: "Required item quantity is unavailable.",
  MAX_PER_ITEM_EXCEEDED: "An item exceeds the per-item spend limit.",
  INCENTIVE_INVALID: "Claimed incentive cannot be validated authoritatively.",
  AMOUNT_CALCULATION_FAILED:
    "Authoritative final amount could not be calculated.",
  MAX_SPEND_EXCEEDED: "Final payable exceeds the authorized maximum spend.",
};

const RECOVERABLE: Record<PolicyReasonCode, boolean> = {
  MANDATE_INVALID: false,
  CATEGORY_NOT_ALLOWED: true,
  STOCK_UNAVAILABLE: true,
  MAX_PER_ITEM_EXCEEDED: true,
  INCENTIVE_INVALID: true,
  AMOUNT_CALCULATION_FAILED: false,
  MAX_SPEND_EXCEEDED: true,
};

/**
 * Deterministic policy evaluation core (Doc 06 order).
 * Durable idempotency: UNIQUE(user_id, idempotency_key) + request fingerprint.
 */
export class PolicyService {
  constructor(
    private readonly repository = new PolicyRepository(),
    private readonly mandateService = new MandateService(),
    private readonly catalog: PolicyCatalogPort = new SupabasePolicyCatalogAdapter(),
    private readonly incentives: IncentivePort = new FailClosedIncentiveAdapter(),
  ) {}

  /**
   * Return a prior decision for the same user+key+fingerprint without re-evaluating.
   * Lookup is always scoped to the authenticated user_id.
   */
  async replayIfPresent(input: {
    user_id: string;
    idempotency_key: string;
    mandate_id: string;
    basket_id: string;
    quote_version: string;
    request_id: string;
  }): Promise<PolicyEvaluationResult | null> {
    const key = input.idempotency_key.trim();
    const fingerprint = buildPolicyRequestFingerprint({
      mandate_id: input.mandate_id,
      basket_id: input.basket_id,
      quote_version: input.quote_version,
    });

    const existing = await this.repository.findByUserIdempotencyKey(
      input.user_id,
      key,
    );
    if (!existing) {
      return null;
    }
    this.assertFingerprintMatch(existing, fingerprint);
    return this.rowToResult(existing, input.request_id);
  }

  /**
   * Evaluate authorization for quantity-only lines under an owned mandate.
   *
   * Trust boundary:
   * - Caller may propose sku_id + quantity (+ optional claimed incentive ids).
   * - Category, stock, unit price, line amount, and final payable come ONLY from
   *   authoritative mandate/catalog/incentive adapters — never from client/LLM.
   * - basket_id is a correlation UUID only (no basket stub/table invented).
   * - Idempotency is scoped to authenticated user_id + Idempotency-Key.
   * Payment execution remains out of scope.
   */
  async evaluate(
    rawInput: unknown,
    now: Date = new Date(),
  ): Promise<PolicyEvaluationResult> {
    const input = parseOrThrow(
      policyEvaluateRequestSchema,
      rawInput,
    ) as PolicyEvaluateRequest;

    const idempotencyKey = input.idempotency_key.trim();
    const fingerprint = buildPolicyRequestFingerprint({
      mandate_id: input.mandate_id,
      basket_id: input.basket_id,
      quote_version: input.quote_version,
    });

    const existing = await this.repository.findByUserIdempotencyKey(
      input.user_id,
      idempotencyKey,
    );
    if (existing) {
      this.assertFingerprintMatch(existing, fingerprint);
      return this.rowToResult(existing, input.request_id);
    }

    const evaluatedAt = now.toISOString();
    const zeroMoney = {
      gross_amount_minor: 0,
      discount_amount_minor: 0,
      final_payable_minor: 0,
      max_spend_minor: 0,
    };

    // --- 1. Mandate validity (ownership + ACTIVE + unexpired) ---
    let mandate: MandateWithCategories;
    try {
      mandate = await this.mandateService.requireValidMandateForAuthorization(
        input.user_id,
        input.mandate_id,
        now,
      );
    } catch (error) {
      if (this.isMandateDenial(error)) {
        // Do not persist NOT_FOUND / UNAUTHORIZED under a foreign mandate:
        // DB trigger requires policy_decision.user_id = mandate.user_id.
        // Owned-but-invalid mandates still persist below after a successful load.
        if (
          isAppError(error) &&
          (error.code === ErrorCodes.MANDATE_NOT_FOUND ||
            error.code === ErrorCodes.MANDATE_UNAUTHORIZED)
        ) {
          throw new AppError({
            code: "MANDATE_INVALID",
            message: DENY_MESSAGES.MANDATE_INVALID,
            statusCode: 422,
            details: { recoverable: false },
          });
        }
        return this.persistAndReturn({
          input,
          idempotencyKey,
          fingerprint,
          decision: "DENY",
          reason_code: "MANDATE_INVALID",
          evaluatedAt,
          amounts: zeroMoney,
        });
      }
      throw error;
    }

    if (mandate.user_id !== input.user_id) {
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "Mandate ownership invariant violated",
        statusCode: 500,
        expose: false,
      });
    }

    const maxSpend = mandate.max_spend_minor;

    // --- Load authoritative catalog state (never trust client prices/categories) ---
    let snapshots: AuthoritativeSkuSnapshot[];
    try {
      snapshots = await this.catalog.loadSkuSnapshots(
        input.lines.map((line) => line.sku_id),
      );
    } catch {
      return this.persistAndReturn({
        input,
        idempotencyKey,
        fingerprint,
        decision: "DENY",
        reason_code: "AMOUNT_CALCULATION_FAILED",
        evaluatedAt,
        amounts: { ...zeroMoney, max_spend_minor: maxSpend },
      });
    }

    const bySku = new Map(snapshots.map((s) => [s.sku_id, s]));

    for (const line of input.lines) {
      const snap = bySku.get(line.sku_id);
      if (
        !snap ||
        snap.sku_status !== "ACTIVE" ||
        snap.product_status !== "ACTIVE" ||
        snap.currency !== "INR" ||
        !Number.isInteger(snap.price_minor) ||
        snap.price_minor < 0 ||
        !snap.category_code
      ) {
        return this.persistAndReturn({
          input,
          idempotencyKey,
          fingerprint,
          decision: "DENY",
          reason_code: "AMOUNT_CALCULATION_FAILED",
          evaluatedAt,
          amounts: { ...zeroMoney, max_spend_minor: maxSpend },
        });
      }
    }

    // --- 2. Category authorization ---
    const allowed = new Set(mandate.allowed_categories);
    for (const line of input.lines) {
      const snap = bySku.get(line.sku_id)!;
      if (!allowed.has(snap.category_code)) {
        return this.persistAndReturn({
          input,
          idempotencyKey,
          fingerprint,
          decision: "DENY",
          reason_code: "CATEGORY_NOT_ALLOWED",
          evaluatedAt,
          amounts: { ...zeroMoney, max_spend_minor: maxSpend },
        });
      }
    }

    // --- 3. Stock availability ---
    for (const line of input.lines) {
      const snap = bySku.get(line.sku_id)!;
      if (
        snap.available_quantity === null ||
        snap.available_quantity < line.quantity
      ) {
        return this.persistAndReturn({
          input,
          idempotencyKey,
          fingerprint,
          decision: "DENY",
          reason_code: "STOCK_UNAVAILABLE",
          evaluatedAt,
          amounts: { ...zeroMoney, max_spend_minor: maxSpend },
        });
      }
    }

    // --- 4. Maximum per-item ---
    if (mandate.max_per_item_minor !== null) {
      for (const line of input.lines) {
        const snap = bySku.get(line.sku_id)!;
        let lineAmount: number;
        try {
          lineAmount = calculateLineAmountMinor(
            line.quantity,
            snap.price_minor,
          );
        } catch {
          return this.persistAndReturn({
            input,
            idempotencyKey,
            fingerprint,
            decision: "DENY",
            reason_code: "AMOUNT_CALCULATION_FAILED",
            evaluatedAt,
            amounts: { ...zeroMoney, max_spend_minor: maxSpend },
          });
        }
        if (lineAmount > mandate.max_per_item_minor) {
          return this.persistAndReturn({
            input,
            idempotencyKey,
            fingerprint,
            decision: "DENY",
            reason_code: "MAX_PER_ITEM_EXCEEDED",
            evaluatedAt,
            amounts: { ...zeroMoney, max_spend_minor: maxSpend },
          });
        }
      }
    }

    // --- 5. Incentive validity ---
    const incentiveResult = await this.incentives.evaluate({
      claimed_incentive_ids: input.claimed_incentive_ids,
    });
    if (!incentiveResult.ok) {
      return this.persistAndReturn({
        input,
        idempotencyKey,
        fingerprint,
        decision: "DENY",
        reason_code: "INCENTIVE_INVALID",
        evaluatedAt,
        amounts: { ...zeroMoney, max_spend_minor: maxSpend },
      });
    }

    // --- 6. Authoritative final amount calculation ---
    let gross: number;
    let discount: number;
    let finalPayable: number;
    try {
      const priced = calculateCartPricing(
        input.lines.map((line) => {
          const snap = bySku.get(line.sku_id)!;
          return {
            quantity: line.quantity,
            price_minor: snap.price_minor,
            currency: snap.currency,
          };
        }),
      );
      gross = priced.gross_amount_minor;

      if (input.claimed_incentive_ids.length === 0) {
        discount = 0;
      } else {
        discount = incentiveResult.discount_amount_minor;
      }

      if (!Number.isInteger(discount) || discount < 0 || discount > gross) {
        throw new Error("invalid discount");
      }
      finalPayable = gross - discount;
      if (!Number.isInteger(finalPayable) || finalPayable < 0) {
        throw new Error("invalid final payable");
      }
    } catch {
      return this.persistAndReturn({
        input,
        idempotencyKey,
        fingerprint,
        decision: "DENY",
        reason_code: "AMOUNT_CALCULATION_FAILED",
        evaluatedAt,
        amounts: { ...zeroMoney, max_spend_minor: maxSpend },
      });
    }

    const amounts = {
      gross_amount_minor: gross,
      discount_amount_minor: discount,
      final_payable_minor: finalPayable,
      max_spend_minor: maxSpend,
    };

    // --- 7. Maximum spend ---
    if (finalPayable > maxSpend) {
      return this.persistAndReturn({
        input,
        idempotencyKey,
        fingerprint,
        decision: "DENY",
        reason_code: "MAX_SPEND_EXCEEDED",
        evaluatedAt,
        amounts,
      });
    }

    // --- 8–10. ALLOW, persist, return ---
    return this.persistAndReturn({
      input,
      idempotencyKey,
      fingerprint,
      decision: "ALLOW",
      reason_code: null,
      evaluatedAt,
      amounts,
    });
  }

  private assertFingerprintMatch(
    existing: PolicyDecisionRow,
    fingerprint: string,
  ): void {
    if (existing.request_fingerprint !== fingerprint) {
      throw new AppError({
        code: ErrorCodes.IDEMPOTENCY_CONFLICT,
        message:
          "Idempotency-Key was reused with a different authorization request.",
        statusCode: 409,
        details: {
          existing_policy_decision_id: existing.policy_decision_id,
        },
      });
    }
  }

  private isMandateDenial(error: unknown): boolean {
    if (!isAppError(error)) {
      return false;
    }
    return (
      error.code === ErrorCodes.MANDATE_NOT_FOUND ||
      error.code === ErrorCodes.MANDATE_UNAUTHORIZED ||
      error.code === ErrorCodes.MANDATE_INVALID
    );
  }

  private async persistAndReturn(args: {
    input: PolicyEvaluateRequest;
    idempotencyKey: string;
    fingerprint: string;
    decision: "ALLOW" | "DENY";
    reason_code: PolicyReasonCode | null;
    evaluatedAt: string;
    amounts: {
      gross_amount_minor: number;
      discount_amount_minor: number;
      final_payable_minor: number;
      max_spend_minor: number;
    };
  }): Promise<PolicyEvaluationResult> {
    const {
      input,
      idempotencyKey,
      fingerprint,
      decision,
      reason_code,
      evaluatedAt,
      amounts,
    } = args;

    if (decision === "DENY" && !reason_code) {
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "DENY requires a reason_code",
        statusCode: 500,
        expose: false,
      });
    }

    try {
      const row = await this.repository.insertDecision({
        user_id: input.user_id,
        mandate_id: input.mandate_id,
        basket_id: input.basket_id,
        decision,
        reason_code,
        gross_amount_minor: amounts.gross_amount_minor,
        discount_amount_minor: amounts.discount_amount_minor,
        final_payable_minor: amounts.final_payable_minor,
        max_spend_minor: amounts.max_spend_minor,
        policy_version: POLICY_VERSION,
        evaluated_at: evaluatedAt,
        request_id: input.request_id,
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint,
      });
      return this.rowToResult(row, input.request_id);
    } catch (error) {
      if (!isUniqueConstraintConflict(error)) {
        throw error;
      }
      const winner = await this.repository.findByUserIdempotencyKey(
        input.user_id,
        idempotencyKey,
      );
      if (!winner) {
        throw new AppError({
          code: ErrorCodes.INTERNAL_ERROR,
          message: "Idempotency conflict could not be resolved",
          statusCode: 500,
          expose: false,
        });
      }
      this.assertFingerprintMatch(winner, fingerprint);
      return this.rowToResult(winner, input.request_id);
    }
  }

  private rowToResult(
    row: PolicyDecisionRow,
    requestIdForResponse: string,
  ): PolicyEvaluationResult {
    const decision = row.decision as "ALLOW" | "DENY";
    const reason_code =
      decision === "DENY"
        ? (row.reason_code as PolicyReasonCode)
        : null;

    return parseOrThrow(policyEvaluationResultSchema, {
      decision,
      reason_code,
      message:
        decision === "DENY" && reason_code
          ? DENY_MESSAGES[reason_code]
          : null,
      recoverable:
        decision === "DENY" && reason_code
          ? RECOVERABLE[reason_code]
          : false,
      policy_decision_id: row.policy_decision_id,
      policy_version: POLICY_VERSION,
      mandate_id: row.mandate_id,
      basket_id: row.basket_id,
      gross_amount_minor: Number(row.gross_amount_minor),
      discount_amount_minor: Number(row.discount_amount_minor),
      final_payable_minor: Number(row.final_payable_minor),
      max_spend_minor: Number(row.max_spend_minor),
      evaluated_at: row.evaluated_at,
      // Correlation for this HTTP call; original row.request_id remains in DB.
      request_id: requestIdForResponse,
    });
  }
}
