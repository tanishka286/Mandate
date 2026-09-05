import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { parseOrThrow } from "../../shared/validation/index.js";
import { sessionIdParamsSchema } from "../intents/schema.js";
import { PlanningService } from "./service.js";
import type { RunSessionPlanData } from "./schema.js";

export class PlanningController {
  constructor(private readonly service = new PlanningService()) {}

  run = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { session_id } = parseOrThrow(sessionIdParamsSchema, req.params);
    const data = await this.service.runSessionPlan(
      userId,
      session_id,
      req.body,
      req.requestId,
    );
    const body: ApiSuccessResponse<RunSessionPlanData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };
}
