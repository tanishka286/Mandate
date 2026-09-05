import { Router } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { CartController } from "./controller.js";

/** Cart routes — Phase 1 Steps 6–9: cart + items + pricing; order state via cart.status. */
export const cartRouter = Router();

const controller = new CartController();

cartRouter.get("/", requireAuth, asyncHandler(controller.getCart));

cartRouter.post("/items", requireAuth, asyncHandler(controller.addItem));

cartRouter.patch(
  "/items/:cart_item_id",
  requireAuth,
  asyncHandler(controller.updateItem),
);

cartRouter.delete(
  "/items/:cart_item_id",
  requireAuth,
  asyncHandler(controller.deleteItem),
);
