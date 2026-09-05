/**
 * Policy routes — Phase 2 Step 5.
 * POST /policy/evaluate — Doc 08 authorization contract.
 *
 * Idempotency-Key is REQUIRED. Durable dedup uses
 * policy_decision UNIQUE (user_id, idempotency_key) + request_fingerprint.
 */
import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import { PolicyController } from "./controller.js";

export const policyRouter = Router();

const controller = new PolicyController();

policyRouter.post(
  "/evaluate",
  requireAuth,
  requireIdempotencyKey,
  asyncHandler(controller.evaluate),
);
