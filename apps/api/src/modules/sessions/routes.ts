import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { IntentsController } from "../intents/controller.js";
import { BasketController } from "../basket/controller.js";

/**
 * Sessions routes — Phase 3 Step 4 + Phase 7 selection.
 * POST /:session_id/intents creates a shopping intent for an ACTIVE owned session.
 * GET  /:session_id/baskets lists CURRENT dual baskets for selection UI.
 * POST /:session_id/basket-selections records USER preference (not authorization).
 * POST /sessions itself is deferred.
 */
export const sessionsRouter = Router();

const intentsController = new IntentsController();
const basketController = new BasketController();

sessionsRouter.post(
  "/:session_id/intents",
  requireAuth,
  asyncHandler(intentsController.create),
);

sessionsRouter.get(
  "/:session_id/baskets",
  requireAuth,
  asyncHandler(basketController.listSessionBaskets),
);

sessionsRouter.post(
  "/:session_id/basket-selections",
  requireAuth,
  asyncHandler(basketController.selectBasket),
);
