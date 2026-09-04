import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getEnv } from "../config/env.js";
import { AppError } from "../shared/errors/index.js";
import { ErrorCodes, AUTHORIZATION_HEADER } from "../shared/constants/index.js";
import type { AuthUser, SessionContext } from "../types/auth.js";

export type { AuthUser, SessionContext };

/**
 * Authentication foundation (Phase 0).
 * Optional bearer JWT verification when JWT_SECRET is configured.
 * Does not implement login/register UI or full identity flows.
 */
export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.header(AUTHORIZATION_HEADER);
  if (!header?.startsWith("Bearer ")) {
    next();
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    next();
    return;
  }

  const { JWT_SECRET } = getEnv();
  if (!JWT_SECRET) {
    // Auth not configured yet " ignore token rather than fail closed on all routes.
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    const id = typeof payload.sub === "string" ? payload.sub : undefined;
    if (!id) {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: "Invalid authentication token",
        statusCode: 401,
      });
    }
    req.user = {
      id,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
    req.sessionContext = {
      sessionId:
        typeof payload.session_id === "string" ? payload.session_id : undefined,
    };
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(
      new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: "Invalid or expired authentication token",
        statusCode: 401,
      }),
    );
  }
}

/** Require an authenticated user on the request. */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user?.id) {
    next(
      new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: "Authentication required",
        statusCode: 401,
      }),
    );
    return;
  }
  next();
}
