import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { registerProductEvidenceRoutes } from "../research/routes.js";
import { CatalogController } from "./controller.js";

/** Catalog routes — Phase 1: categories + search. */
export const catalogRouter = Router();

/** Product routes — Phase 1 detail + Phase 4 evidence (mounted at /products). */
export const productsRouter = Router();

const controller = new CatalogController();

catalogRouter.get(
  "/categories",
  asyncHandler(controller.listCategories),
);

catalogRouter.get(
  "/search",
  asyncHandler(controller.searchCatalog),
);

// Evidence before /:product_id so "evidence" is not parsed as a product id segment.
registerProductEvidenceRoutes(productsRouter);

productsRouter.get(
  "/:product_id",
  asyncHandler(controller.getProduct),
);
