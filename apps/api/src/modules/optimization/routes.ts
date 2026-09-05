import { Router } from "express";

/**
 * Optimization routes — POST /optimization-runs mounts in a later Phase 5 step.
 * Step 1 ships domain feasibility/fulfillment only (no premature HTTP surface).
 */
export const optimizationRouter = Router();
