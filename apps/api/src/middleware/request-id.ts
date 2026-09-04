import type { NextFunction, Request, Response } from "express";
import { REQUEST_ID_HEADER } from "../shared/constants/index.js";
import { createRequestId } from "../shared/ids/index.js";

/**
 * Correlation / request ID middleware.
 * Honors inbound X-Request-ID; otherwise generates one.
 * Available on req.requestId for handlers, services, logs, and errors.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(REQUEST_ID_HEADER)?.trim();
  const requestId = incoming && incoming.length > 0 ? incoming : createRequestId();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
