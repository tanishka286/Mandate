import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { ResearchController } from "./controller.js";

/** Standalone research router (unused for nested product evidence). */
export const researchRouter = Router();

/**
 * Mount GET /:product_id/evidence on the products router (Doc 08 §9.3).
 * Must be registered before GET /:product_id.
 * Same application boundary as catalog product reads (no requireAuth).
 */
export function registerProductEvidenceRoutes(router: Router): void {
  const controller = new ResearchController();
  router.get(
    "/:product_id/evidence",
    asyncHandler(controller.getProductEvidence),
  );
}
