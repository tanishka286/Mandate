import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequirementsController } from "./controller.js";

/**
 * Doc 08: POST /intents/{intent_id}/requirements:extract
 * Mounted at /intents in the v1 router.
 */
export const intentRequirementsRouter = Router();

const controller = new RequirementsController();

intentRequirementsRouter.post(
  "/:intent_id/requirements:extract",
  requireAuth,
  asyncHandler(controller.extract),
);

/** Unused standalone router kept for module pattern parity. */
export const requirementsRouter = Router();
