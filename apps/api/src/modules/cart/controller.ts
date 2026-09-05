import type { Request, Response } from "express";
import type { ApiSuccessResponse } from "@mandate/types";
import { parseOrThrow } from "../../shared/validation/index.js";
import { CartService } from "./service.js";
import {
  cartItemParamsSchema,
  type CartItem,
  type CartWithItems,
} from "./schema.js";

/**
 * Cart controller — Phase 1 Steps 6–8.
 * Ownership from authenticated identity. Pricing is server-side only.
 */
export class CartController {
  constructor(private readonly service = new CartService()) {}

  getCart = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    // Client financial query/body values are never read for pricing.
    const data = await this.service.getOpenCartForUser(userId);
    const body: ApiSuccessResponse<CartWithItems> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };

  addItem = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const data = await this.service.addCartItem(userId, req.body);
    const body: ApiSuccessResponse<CartItem> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(201).json(body);
  };

  updateItem = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { cart_item_id } = parseOrThrow(cartItemParamsSchema, req.params);
    const data = await this.service.updateCartItem(
      userId,
      cart_item_id,
      req.body,
    );
    const body: ApiSuccessResponse<CartItem> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };

  deleteItem = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { cart_item_id } = parseOrThrow(cartItemParamsSchema, req.params);
    const data = await this.service.deleteCartItem(userId, cart_item_id);
    const body: ApiSuccessResponse<{ cart_item_id: string; deleted: true }> = {
      data,
      meta: { request_id: req.requestId },
    };
    res.status(200).json(body);
  };
}
