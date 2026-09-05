import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { BasketController } from "./controller.js";

/**
 * Basket routes — Phase 7.
 * Mounted at /baskets for quote; session selection is registered on sessionsRouter.
 */
export const basketRouter = Router();

const controller = new BasketController();

basketRouter.post(
  "/:basket_id/quote",
  requireAuth,
  asyncHandler(controller.createQuote),
);

export { BasketController };
