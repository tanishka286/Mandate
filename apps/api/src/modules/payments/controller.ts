import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { AppError, isAppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { PaymentsService } from "./service.js";
import { verifyPaymentRequestBodySchema } from "./schema.js";
import type { VerifyPaymentResult } from "./types.js";

/**
 * Payments controller — Phase 8 Step 6.
 *
 * Authenticated HTTP transport boundary for payment verification.
 * Mounted at POST /api/v1/payments/verify.
 *
 * Invariants:
 * 1. Requires valid JWT (trusted req.user.id).
 * 2. User identity never accepted from request body.
 * 3. Strict request validation (unknown/client-controlled financial/status fields rejected).
 * 4. Provider boundary failures mapped to HTTP 424 PAYMENT_PROVIDER_ERROR (Doc 08).
 * 5. Sanitized response: no secrets, no internal DB state.
 */
export class PaymentsController {
  constructor(private readonly service = new PaymentsService()) {}

  verify = async (req: Request, res: Response): Promise<void> => {
    // 1. Authenticated user identity from trusted context only
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: "Authentication required for payment verification",
        statusCode: 401,
      });
    }

    // 2. Validate request body with strict schema (rejects extra/client-controlled fields)
    const body = parseOrThrow(verifyPaymentRequestBodySchema, req.body);

    // 3. Delegate to PaymentsService with provider-boundary error mapping (Doc 08 §24 -> 424)
    let result: VerifyPaymentResult;
    try {
      result = await this.service.verifyPayment({
        user_id: userId,
        order_id: body.order_id,
        razorpay_order_id: body.razorpay_order_id,
        razorpay_payment_id: body.razorpay_payment_id,
        razorpay_signature: body.razorpay_signature,
      });
    } catch (error) {
      if (
        isAppError(error) &&
        (error.code === "PAYMENT_PROVIDER_ERROR" ||
          (typeof error.code === "string" &&
            error.code.startsWith("PAYMENT_PROVIDER_")))
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

    // 4. Return sanitized success response
    const response: ApiSuccessResponse<VerifyPaymentResult> = {
      data: result,
      meta: { request_id: req.requestId },
    };

    res.status(200).json(response);
  };
}
