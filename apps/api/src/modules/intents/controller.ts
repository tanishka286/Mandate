import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { parseOrThrow } from "../../shared/validation/index.js";
import { IntentsService } from "./service.js";
import {
  sessionIdParamsSchema,
  type CreateShoppingIntentData,
} from "./schema.js";

/**
 * Shopping intent controller — Phase 3 Step 4.
 * Thin HTTP adapter; ownership and mandate resolution live in the service.
 */
export class IntentsController {
  constructor(private readonly service = new IntentsService()) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { session_id } = parseOrThrow(sessionIdParamsSchema, req.params);
    const data = await this.service.createIntent(
      userId,
      session_id,
      req.body,
    );
    const body: ApiSuccessResponse<CreateShoppingIntentData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(201).json(body);
  };
}
