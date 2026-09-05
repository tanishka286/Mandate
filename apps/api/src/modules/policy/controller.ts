import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { AppError } from "../../shared/errors/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { PolicyService } from "./service.js";
import {
  type QuoteResolutionPort,
} from "./quote-adapter.js";
import { PersistedQuoteAdapter } from "../basket/quote-adapter.js";
import {
  policyEvaluateAllowDataSchema,
  policyEvaluateHttpBodySchema,
  type PolicyEvaluateAllowData,
  type PolicyEvaluationResult,
  type PolicyReasonCode,
} from "./schema.js";

const DENY_STATUS = 422;

/**
 * Policy HTTP controller — Phase 2 Step 5.
 * Thin boundary over PolicyService. No duplicated evaluation logic.
 * Phase 7: default quote port resolves persisted basket_quote rows.
 */
export class PolicyController {
  constructor(
    private readonly service = new PolicyService(),
    private readonly quotes: QuoteResolutionPort = new PersistedQuoteAdapter(),
  ) {}

  evaluate = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const idempotencyKey = req.idempotencyKey!;
    const body = parseOrThrow(policyEvaluateHttpBodySchema, req.body);

    // Replay before quote resolution so retries do not require quote domain.
    const replay = await this.service.replayIfPresent({
      user_id: userId,
      idempotency_key: idempotencyKey,
      mandate_id: body.mandate_id,
      basket_id: body.basket_id,
      quote_version: body.quote_version,
      request_id: req.requestId,
    });
    if (replay) {
      this.writeResult(req, res, replay);
      return;
    }

    const quote = await this.quotes.resolve({
      user_id: userId,
      basket_id: body.basket_id,
      quote_version: body.quote_version,
    });

    if (!quote || quote.lines.length === 0) {
      throw new AppError({
        code: "AMOUNT_CALCULATION_FAILED",
        message: "Authoritative quote is unavailable for policy evaluation.",
        statusCode: DENY_STATUS,
        details: {
          basket_id: body.basket_id,
          quote_version: body.quote_version,
          recoverable: false,
        },
      });
    }

    const result = await this.service.evaluate({
      user_id: userId,
      mandate_id: body.mandate_id,
      basket_id: body.basket_id,
      request_id: req.requestId,
      idempotency_key: idempotencyKey,
      quote_version: body.quote_version,
      lines: quote.lines,
      claimed_incentive_ids: quote.claimed_incentive_ids,
    });

    this.writeResult(req, res, result);
  };

  private writeResult(
    req: Request,
    res: Response,
    result: PolicyEvaluationResult,
  ): void {
    if (result.decision === "DENY") {
      const reason = result.reason_code as PolicyReasonCode;
      throw new AppError({
        code: reason,
        message:
          result.message ??
          "Policy evaluation denied the authorization request.",
        statusCode: DENY_STATUS,
        details: {
          final_payable_minor: result.final_payable_minor,
          max_spend_minor: result.max_spend_minor,
          recoverable: result.recoverable,
          policy_decision_id: result.policy_decision_id,
          policy_version: result.policy_version,
        },
      });
    }

    const data = parseOrThrow(policyEvaluateAllowDataSchema, {
      policy_decision_id: result.policy_decision_id,
      decision: "ALLOW" as const,
      reason_code: "AUTHORIZED" as const,
      final_payable_minor: result.final_payable_minor,
      policy_version: result.policy_version,
    }) as PolicyEvaluateAllowData;

    const response: ApiSuccessResponse<PolicyEvaluateAllowData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(response);
  }
}
