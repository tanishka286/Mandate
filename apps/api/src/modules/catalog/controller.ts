import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { parseOrThrow } from "../../shared/validation/index.js";
import { CatalogService } from "./service.js";
import { productParamsSchema } from "./schema.js";
import type {
  CatalogSearchResult,
  CategoryListData,
  ProductDetail,
} from "./types.js";

/**
 * Catalog controller — Category + Product + SKU + Stock + Search (Phase 1 Steps 1–5).
 * No direct database access from controllers.
 */
export class CatalogController {
  constructor(private readonly service = new CatalogService()) {}

  listCategories = async (req: Request, res: Response): Promise<void> => {
    const data = await this.service.listCategories();
    const body: ApiSuccessResponse<CategoryListData> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };

  searchCatalog = async (req: Request, res: Response): Promise<void> => {
    const data = await this.service.searchCatalog(req.query);
    const body: ApiSuccessResponse<CatalogSearchResult> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };

  getProduct = async (req: Request, res: Response): Promise<void> => {
    const { product_id } = parseOrThrow(productParamsSchema, req.params);
    const data = await this.service.getProductById(product_id);
    const body: ApiSuccessResponse<ProductDetail> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };
}
