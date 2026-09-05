import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { AppError } from "../../../shared/errors/index.js";
import { ErrorCodes } from "../../../shared/constants/index.js";
import { RazorpayWebhookService } from "./service.js";
import type { WebhookProcessResult } from "../../payments/types.js";

const SIGNATURE_HEADER = "x-razorpay-signature";

/**
 * Razorpay webhook controller — Phase 8 Step 7.
 * Provider-authenticated transport boundary (no end-user JWT).
 */
export class RazorpayWebhookController {
  constructor(private readonly service = new RazorpayWebhookService()) {}

  handle = async (req: Request, res: Response): Promise<void> => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === "string"
        ? Buffer.from(req.body, "utf8")
        : null;

    if (!rawBody || rawBody.length === 0) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Webhook body is required",
        statusCode: 400,
      });
    }

    const signature = req.header(SIGNATURE_HEADER);

    const result = await this.service.processWebhook({
      rawBody,
      signature,
      request_id: req.requestId,
    });

    const response: ApiSuccessResponse<WebhookProcessResult> = {
      data: result,
      meta: { request_id: req.requestId },
    };

    res.status(200).json(response);
  };
}
