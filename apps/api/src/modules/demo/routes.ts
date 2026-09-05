import jwt from "jsonwebtoken";
import { Router } from "express";
import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { getEnv } from "../../config/env.js";
import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { asyncHandler } from "../../shared/http/async-handler.js";

/** Deterministic demo shopper from supabase/seed.sql */
const DEMO_USER_ID = "44444444-4444-4444-8444-444444444401";
const DEMO_MANDATE_A = "77777777-7777-4777-8777-777777777701";

type DemoTokenData = {
  token: string;
  user_id: string;
  mandate_id: string;
};

/**
 * Dev/demo token issuer — not a full auth system.
 * Disabled in production. Frontend uses the token only against the Mandate API.
 */
export async function issueDemoTokenHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const env = getEnv();
  if (env.NODE_ENV === "production") {
    throw new AppError({
      code: ErrorCodes.NOT_FOUND,
      message: "Not found",
      statusCode: 404,
    });
  }
  if (!env.JWT_SECRET) {
    throw new AppError({
      code: ErrorCodes.INTERNAL_ERROR,
      message: "Demo authentication is not configured",
      statusCode: 503,
    });
  }

  const token = jwt.sign({ sub: DEMO_USER_ID }, env.JWT_SECRET, {
    expiresIn: "1h",
  });
  const body: ApiSuccessResponse<DemoTokenData> = {
    data: {
      token,
      user_id: DEMO_USER_ID,
      mandate_id: DEMO_MANDATE_A,
    },
    meta: { request_id: req.requestId },
  };
  res.status(200).json(body);
}

export const demoRouter = Router();

demoRouter.post("/token", asyncHandler(issueDemoTokenHandler));
