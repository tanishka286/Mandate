import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { parseOrThrow } from "../../shared/validation/index.js";
import { ResearchService } from "./service.js";
import {
  productEvidenceParamsSchema,
  type ProductEvidenceList,
} from "./schema.js";

/**
 * Research controller — Phase 4 Step 2.
 * GET /products/{product_id}/evidence. No direct database access.
 */
export class ResearchController {
  constructor(private readonly service = new ResearchService()) {}

  getProductEvidence = async (req: Request, res: Response): Promise<void> => {
    const { product_id } = parseOrThrow(
      productEvidenceParamsSchema,
      req.params,
    );
    const data = await this.service.getProductEvidence(product_id);
    const body: ApiSuccessResponse<ProductEvidenceList> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };
}
