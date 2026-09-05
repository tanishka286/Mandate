import type { NextFunction, Request, Response } from "express";
import { logger } from "../shared/logger/index.js";

/**
 * Structured request/response logging with correlation ID.
 * Does not log secrets, bodies, or authorization headers.
 */
export function requestLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const level =
      res.statusCode >= 500
        ? "error"
        : res.statusCode >= 400
          ? "warn"
          : "info";

    logger[level]("HTTP request completed", {
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status_code: res.statusCode,
      duration_ms: durationMs,
    });
  });

  next();
}
