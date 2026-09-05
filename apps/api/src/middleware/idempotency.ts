import type { NextFunction, Request, Response } from "express";
import { AppError } from "../shared/errors/index.js";
import {
  ErrorCodes,
  IDEMPOTENCY_KEY_HEADER,
} from "../shared/constants/index.js";

/**
 * Idempotency foundation.
 * Captures Idempotency-Key when present; does not persist/enforce by itself.
 * Endpoints that authorize or create financial state must call requireIdempotencyKey.
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

/**
 * Require a nonempty Idempotency-Key (Doc 08 §3.6 / §24 for financial auth).
 * Does not implement replay/dedup persistence — that needs a durable store.
 */
export function requireIdempotencyKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const key = req.idempotencyKey?.trim();
  if (!key) {
    next(
      new AppError({
        code: ErrorCodes.IDEMPOTENCY_REQUIRED,
        message: "Idempotency-Key header is required for this operation.",
        statusCode: 400,
        details: { header: IDEMPOTENCY_KEY_HEADER },
      }),
    );
    return;
  }
  req.idempotencyKey = key;
  next();
}
