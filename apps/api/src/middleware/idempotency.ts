import type { NextFunction, Request, Response } from "express";
import { IDEMPOTENCY_KEY_HEADER } from "../shared/constants/index.js";

/**
 * Idempotency foundation for future financial operations.
 * Captures Idempotency-Key when present; does not yet enforce persistence.
 */
export function idempotencyMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const key = req.header(IDEMPOTENCY_KEY_HEADER)?.trim();
  if (key) {
    req.idempotencyKey = key;
  }
  next();
}

export interface IdempotencyContext {
  key: string;
  requestId: string;
}

export function getIdempotencyContext(req: Request): IdempotencyContext | null {
  if (!req.idempotencyKey) {
    return null;
  }
  return {
    key: req.idempotencyKey,
    requestId: req.requestId,
  };
}
