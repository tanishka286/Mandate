import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { parseOrThrow } from "../../shared/validation/index.js";
import { BasketService } from "./service.js";
import {
  basketIdParamsSchema,
  sessionIdParamsSchema,
  type BasketQuoteData,
  type BasketSelectionData,
  type SessionBasketsData,
} from "./schema.js";

/**
 * Basket controller — Phase 7 selection + fresh quote + session basket read.
 * Ownership from authenticated identity only. No client financial authority.
 */
export class BasketController {
  constructor(private readonly service = new BasketService()) {}

  listSessionBaskets = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { session_id } = parseOrThrow(sessionIdParamsSchema, req.params);
    const data = await this.service.getSessionBaskets(userId, session_id);
    const body: ApiSuccessResponse<SessionBasketsData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };

  selectBasket = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { session_id } = parseOrThrow(sessionIdParamsSchema, req.params);
    const data = await this.service.selectBasket(
      userId,
      session_id,
      req.body,
      req.requestId,
    );
    const body: ApiSuccessResponse<BasketSelectionData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(201).json(body);
  };

  createQuote = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { basket_id } = parseOrThrow(basketIdParamsSchema, req.params);
    const data = await this.service.createFreshQuote(
      userId,
      basket_id,
      req.body,
      req.requestId,
    );
    const body: ApiSuccessResponse<BasketQuoteData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(201).json(body);
  };
}
