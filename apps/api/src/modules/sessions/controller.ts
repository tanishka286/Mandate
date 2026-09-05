import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { SessionsService } from "./service.js";
import type { CreateShoppingSessionData } from "./schema.js";

/**
 * Shopping session controller — Phase 10 session start for demo/E2E.
 */
export class SessionsController {
  constructor(private readonly service = new SessionsService()) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const data = await this.service.createSession(userId);
    const body: ApiSuccessResponse<CreateShoppingSessionData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(201).json(body);
  };
}
