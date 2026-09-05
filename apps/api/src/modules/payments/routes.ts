import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { PaymentsController } from "./controller.js";

/**
 * Payments routes — Phase 8 Step 6.
 * Mounted at /api/v1/payments.
 *
 * Protected verification endpoint:
 * POST /api/v1/payments/verify (requires valid JWT Bearer token)
 */
export const paymentsRouter = Router();

const controller = new PaymentsController();

paymentsRouter.post(
  "/verify",
  requireAuth,
  asyncHandler(controller.verify),
);
