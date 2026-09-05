import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { AuditController } from "./controller.js";

/** Audit routes — mounted under /sessions for session-scoped audit trail. */
export const auditRouter = Router();

const auditController = new AuditController();

auditRouter.get(
  "/:session_id/audit",
  requireAuth,
  asyncHandler(auditController.listSessionAudit),
);
