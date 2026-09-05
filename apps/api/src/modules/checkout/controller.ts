import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { AppError, isAppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { CheckoutService } from "./service.js";
import { checkoutRequestBodySchema } from "./schema.js";
import type { CheckoutResponseData } from "./types.js";

/**
 * Checkout controller — Phase 8 Step 5.
 * Authenticated HTTP transport boundary for checkout orchestration.
 *
 * Responsibilities:
 * 1. Authenticate caller (via requireAuth).
 * 2. Validate Idempotency-Key header (via requireIdempotencyKey).
 * 3. Validate request body (selection_id, policy_decision_id).
 * 4. Pass trusted user identity + correlation identifiers to CheckoutService.
 * 5. Return sanitized checkout handoff payload (no secrets, no internal fingerprints).
 * 6. Map provider boundary failures to HTTP 424 PAYMENT_PROVIDER_ERROR (Doc 08).
 *
 * Server-only boundary: no client-controlled financial values or payment states accepted.
 */
export class CheckoutController {
  constructor(private readonly service = new CheckoutService()) {}

  checkout = async (req: Request, res: Response): Promise<void> => {
    // 1. Authenticated user identity from trusted context only
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: "Authentication required for checkout",
        statusCode: 401,
      });
    }

    // 2. Validate Idempotency-Key header
    const idempotencyKey = req.idempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new AppError({
        code: ErrorCodes.IDEMPOTENCY_REQUIRED,
        message: "Idempotency-Key header is required for checkout",
        statusCode: 400,
      });
    }

    // 3. Validate request body with strict schema
    const body = parseOrThrow(checkoutRequestBodySchema, req.body);

    // 4. Invoke trusted CheckoutService with provider-boundary error mapping (Doc 08 §24 -> 424)
    let result;
    try {
      result = await this.service.checkout({
        user_id: userId,
        session_id: req.sessionContext?.sessionId,
        selection_id: body.selection_id,
        policy_decision_id: body.policy_decision_id,
        idempotency_key: idempotencyKey,
        request_id: req.requestId,
      });
    } catch (error) {
      if (
        isAppError(error) &&
        (error.code === "PAYMENT_PROVIDER_ERROR" ||
          (typeof error.code === "string" && error.code.startsWith("PAYMENT_PROVIDER_")))
      ) {
        throw new AppError({
          code: "PAYMENT_PROVIDER_ERROR",
          message: error.message,
          statusCode: 424,
          details: error.details,
        });
      }
      throw error;
    }

    // 5. Build sanitized response (no secrets, no internal DB state)
    const response: ApiSuccessResponse<CheckoutResponseData> = {
      data: {
        order_id: result.order_id,
        razorpay_order_id: result.razorpay_order_id,
        amount_minor: result.amount_minor,
        currency: result.currency,
        status: result.status,
        ...(result.razorpay_key_id ? { razorpay_key_id: result.razorpay_key_id } : {}),
      },
      meta: { request_id: req.requestId },
    };

    res.status(201).json(response);
  };
}
