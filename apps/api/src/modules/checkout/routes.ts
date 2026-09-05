import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import { CheckoutController } from "./controller.js";

/**
 * Checkout routes — Phase 8 Step 5.
 * Mounted at /api/v1/checkout.
 *
 * Protected endpoint: requires valid JWT Bearer token + non-empty Idempotency-Key header.
 */
export const checkoutRouter = Router();

const controller = new CheckoutController();

checkoutRouter.post(
  "/",
  requireAuth,
  requireIdempotencyKey,
  asyncHandler(controller.checkout),
);
