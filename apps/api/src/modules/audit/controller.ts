import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { SessionsRepository } from "../sessions/repository.js";
import { AuditService } from "./service.js";
import {
  sessionAuditTrailDataSchema,
  sessionIdAuditParamsSchema,
} from "./schema.js";
import type { SessionAuditTrailData } from "./types.js";

/**
 * Audit controller — Phase 9 session audit trail read API.
 */
export class AuditController {
  constructor(
    private readonly auditService = new AuditService(),
    private readonly sessionsRepository = new SessionsRepository(),
  ) {}

  listSessionAudit = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { session_id } = parseOrThrow(sessionIdAuditParamsSchema, req.params);

    const session = await this.sessionsRepository.findById(session_id);
    if (!session) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Shopping session not found",
        statusCode: 404,
        details: { session_id },
      });
    }

    if (session.user_id !== userId) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Shopping session does not belong to the authenticated user",
        statusCode: 403,
        details: { session_id },
      });
    }

    const trail = await this.auditService.getSessionAuditTrail(
      userId,
      session_id,
      session.user_id,
    );

    const data = parseOrThrow(
      sessionAuditTrailDataSchema,
      trail,
    ) as SessionAuditTrailData;

    const body: ApiSuccessResponse<SessionAuditTrailData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };
}
