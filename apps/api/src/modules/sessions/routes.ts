import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { IntentsController } from "../intents/controller.js";
import { BasketController } from "../basket/controller.js";
import { PlanningController } from "../planning/controller.js";
import { auditRouter } from "../audit/routes.js";
import { SessionsController } from "./controller.js";

/**
 * Sessions routes — Phase 3 Step 4 + Phase 7 selection + Phase 10 demo start.
 */
export const sessionsRouter = Router();

sessionsRouter.use(auditRouter);

const sessionsController = new SessionsController();
const intentsController = new IntentsController();
const basketController = new BasketController();
const planningController = new PlanningController();

sessionsRouter.post(
  "/",
  requireAuth,
  asyncHandler(sessionsController.create),
);

sessionsRouter.post(
  "/:session_id/intents",
  requireAuth,
  asyncHandler(intentsController.create),
);

sessionsRouter.post(
  "/:session_id/plan",
  requireAuth,
  asyncHandler(planningController.run),
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
