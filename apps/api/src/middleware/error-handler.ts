import type { NextFunction, Request, Response } from "express";
import type { ApiErrorResponse } from "@mandate/types";
import { toSafeClientMessage } from "../shared/errors/index.js";
import { logger } from "../shared/logger/index.js";

/**
 * Central error handler. Never returns stack traces or secrets.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const safe = toSafeClientMessage(err);
  const requestId = req.requestId ?? "unknown";

  logger.error("Request failed", {
    request_id: requestId,
    code: safe.code,
    statusCode: safe.statusCode,
    path: req.path,
    method: req.method,
  });

  const body: ApiErrorResponse = {
    error: {
      code: safe.code,
      message: safe.message,
      details: safe.details,
      request_id: requestId,
    },
  };

  res.status(safe.statusCode).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorResponse = {
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.path}`,
      details: {},
      request_id: req.requestId ?? "unknown",
    },
  };
  res.status(404).json(body);
}
