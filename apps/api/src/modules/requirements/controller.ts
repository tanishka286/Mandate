import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { parseOrThrow } from "../../shared/validation/index.js";
import {
  intentIdParamsSchema,
  type RequirementExtractionResponseData,
} from "./extraction-schema.js";
import { RequirementsService } from "./service.js";

/**
 * Requirements controller — Phase 3 Step 5.
 * Thin HTTP adapter for requirement extraction.
 */
export class RequirementsController {
  constructor(private readonly service = new RequirementsService()) {}

  extract = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { intent_id } = parseOrThrow(intentIdParamsSchema, req.params);
    const data = await this.service.extractRequirements(userId, intent_id);
    const body: ApiSuccessResponse<RequirementExtractionResponseData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };
}
