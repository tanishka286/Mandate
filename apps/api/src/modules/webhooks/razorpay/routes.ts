import { Router } from "express";
import { asyncHandler } from "../../../shared/http/async-handler.js";
import { RazorpayWebhookController } from "./controller.js";

/**
 * Razorpay webhook routes — Phase 8 Step 7.
 * Mounted at POST /api/v1/webhooks/razorpay (provider signature auth only).
 */
export const razorpayWebhookRouter = Router();

const controller = new RazorpayWebhookController();

razorpayWebhookRouter.post("/", asyncHandler(controller.handle));
