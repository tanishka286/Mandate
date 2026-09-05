import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { CartRepository } from "./repository.js";
import { calculateCartPricing } from "./pricing.js";
import { transition } from "./order-state.js";
import {
  addCartItemBodySchema,
  cartItemIdSchema,
  cartItemSchema,
  cartQuantitySchema,
  cartSchema,
  cartWithItemsSchema,
  updateCartItemBodySchema,
  userIdSchema,
  type AddCartItemBody,
  type ApplicationOrder,
  type CartItem,
  type CartItemView,
  type CartWithItems,
  type UpdateCartItemBody,
} from "./schema.js";
import type {
  CartItemRow,
  CartItemViewRow,
  CartRow,
  SkuEligibilityRow,
} from "./types.js";

/**
 * Cart service — Phase 1 Steps 6–9.
 * Ownership from authenticated user_id only.
 * Pricing uses current authoritative sku.price_minor (no persisted totals).
 * Application order state = cart.status (OPEN_CART | CANCELLED).
 *
 * Duplicate SKU behavior (deterministic):
 * If (cart_id, sku_id) already exists, set quantity to the requested
 * absolute quantity after stock validation. Never insert a second row.
 */
export class CartService {
  constructor(private readonly repository = new CartRepository()) {}

  async getOpenCartForUser(userId: string): Promise<CartWithItems> {
    parseOrThrow(userIdSchema, userId);

    const row = await this.requireOpenCart(userId);
    const itemRows = await this.repository.listCartItemsWithCatalog(row.cart_id);

    // Price only valid ACTIVE Product + ACTIVE SKU lines; fail explicitly otherwise.
    const pricingInputs = itemRows.map((item) => {
      this.assertLinePriceable(item);
      const sku = item.sku!;
      return {
        quantity: item.quantity,
        price_minor: Number(sku.price_minor),
        currency: sku.currency,
      };
    });

    let pricing;
    try {
      pricing = calculateCartPricing(pricingInputs);
    } catch (error) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          error instanceof Error
            ? error.message
            : "Cart pricing could not be calculated",
        statusCode: 400,
      });
    }

    const items: CartItemView[] = itemRows.map((item, index) => {
      const amounts = pricing.lines[index]!;
      return this.toCartItemView(item, amounts.unit_price_minor, amounts.line_amount_minor);
    });

    return parseOrThrow(cartWithItemsSchema, {
      cart_id: row.cart_id,
      user_id: row.user_id,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      items,
      gross_amount_minor: pricing.gross_amount_minor,
      discount_amount_minor: pricing.discount_amount_minor,
      final_payable_minor: pricing.final_payable_minor,
      currency: pricing.currency,
    });
  }

  /**
   * Server-side application order cancel: OPEN_CART → CANCELLED.
   * Not exposed as a client status-mutation endpoint.
   */
  async cancelOpenCartForUser(userId: string): Promise<ApplicationOrder> {
    parseOrThrow(userIdSchema, userId);
    const cart = await this.requireOpenCart(userId);
    const next = transition(cart.status, "CANCELLED");
    const updated = await this.repository.updateCartStatus(cart.cart_id, next);
    return parseOrThrow(cartSchema, {
      cart_id: updated.cart_id,
      user_id: updated.user_id,
      status: updated.status,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    });
  }

  async addCartItem(
    userId: string,
    body: unknown,
  ): Promise<CartItem> {
    parseOrThrow(userIdSchema, userId);
    const input = parseOrThrow(addCartItemBodySchema, body) as AddCartItemBody;

    const cart = await this.requireOpenCart(userId);
    await this.assertSkuEligibleForQuantity(input.sku_id, input.quantity);

    const existing = await this.repository.findCartItemByCartAndSku(
      cart.cart_id,
      input.sku_id,
    );

    if (existing) {
      const updated = await this.repository.updateCartItemQuantity(
        existing.cart_item_id,
        input.quantity,
      );
      return this.toCartItem(updated);
    }

    const created = await this.repository.insertCartItem({
      cart_id: cart.cart_id,
      sku_id: input.sku_id,
      quantity: input.quantity,
    });
    return this.toCartItem(created);
  }

  async updateCartItem(
    userId: string,
    cartItemId: string,
    body: unknown,
  ): Promise<CartItem> {
    parseOrThrow(userIdSchema, userId);
    parseOrThrow(cartItemIdSchema, cartItemId);
    const input = parseOrThrow(
      updateCartItemBodySchema,
      body,
    ) as UpdateCartItemBody;

    const owned = await this.requireOwnedCartItem(userId, cartItemId);
    await this.assertSkuEligibleForQuantity(owned.sku_id, input.quantity);

    const updated = await this.repository.updateCartItemQuantity(
      owned.cart_item_id,
      input.quantity,
    );
    return this.toCartItem(updated);
  }

  async deleteCartItem(
    userId: string,
    cartItemId: string,
  ): Promise<{ cart_item_id: string; deleted: true }> {
    parseOrThrow(userIdSchema, userId);
    parseOrThrow(cartItemIdSchema, cartItemId);

    const owned = await this.requireOwnedCartItem(userId, cartItemId);
    await this.repository.deleteCartItem(owned.cart_item_id);

    return { cart_item_id: owned.cart_item_id, deleted: true };
  }

  private async requireOpenCart(userId: string): Promise<CartRow> {
    const row = await this.repository.findOpenCartByUserId(userId);
    if (!row) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Active cart not found",
        statusCode: 404,
        details: { user_id: userId },
      });
    }

    if (row.user_id !== userId) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Cart does not belong to the authenticated user",
        statusCode: 403,
      });
    }

    return row;
  }

  private async requireOwnedCartItem(
    userId: string,
    cartItemId: string,
  ): Promise<CartItemRow> {
    const row = await this.repository.findCartItemById(cartItemId);
    if (!row || !row.cart) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Cart item not found",
        statusCode: 404,
        details: { cart_item_id: cartItemId },
      });
    }

    if (row.cart.user_id !== userId) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Cart item does not belong to the authenticated user",
        statusCode: 403,
      });
    }

    return {
      cart_item_id: row.cart_item_id,
      cart_id: row.cart_id,
      sku_id: row.sku_id,
      quantity: row.quantity,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private async assertSkuEligibleForQuantity(
    skuId: string,
    quantity: number,
  ): Promise<void> {
    parseOrThrow(cartQuantitySchema, quantity);

    const sku = await this.repository.getSkuEligibility(skuId);
    if (!sku) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "SKU not found",
        statusCode: 404,
        details: { sku_id: skuId },
      });
    }

    if (sku.status !== "ACTIVE") {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "SKU is not active",
        statusCode: 400,
        details: { sku_id: skuId, status: sku.status },
      });
    }

    if (!sku.product || sku.product.status !== "ACTIVE") {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Product is not active",
        statusCode: 400,
        details: {
          sku_id: skuId,
          product_id: sku.product_id,
          status: sku.product?.status ?? null,
        },
      });
    }

    const available = this.readAvailableQuantity(sku.stock);
    if (available === null) {
      throw new AppError({
        code: ErrorCodes.STOCK_UNAVAILABLE,
        message: "Stock availability cannot be established",
        statusCode: 422,
        details: { sku_id: skuId },
      });
    }

    if (available < quantity) {
      throw new AppError({
        code: ErrorCodes.STOCK_UNAVAILABLE,
        message: "Requested quantity exceeds available stock",
        statusCode: 422,
        details: {
          sku_id: skuId,
          requested_quantity: quantity,
          available_quantity: available,
        },
      });
    }
  }

  /**
   * Pricing requires ACTIVE Product + ACTIVE SKU with a resolvable INR price.
   * Inactive/stale lines are not silently totaled.
   */
  private assertLinePriceable(row: CartItemViewRow): void {
    const sku = row.sku;
    if (!sku || !sku.product) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Cart item is missing catalog identity required for pricing",
        statusCode: 400,
        details: { cart_item_id: row.cart_item_id, sku_id: row.sku_id },
      });
    }

    if (sku.status !== "ACTIVE") {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Cannot price cart containing an inactive SKU",
        statusCode: 400,
        details: {
          cart_item_id: row.cart_item_id,
          sku_id: row.sku_id,
          status: sku.status,
        },
      });
    }

    if (sku.product.status !== "ACTIVE") {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Cannot price cart containing an inactive Product",
        statusCode: 400,
        details: {
          cart_item_id: row.cart_item_id,
          product_id: sku.product.product_id,
          status: sku.product.status,
        },
      });
    }
  }

  private readAvailableQuantity(
    stock: SkuEligibilityRow["stock"],
  ): number | null {
    if (!stock) {
      return null;
    }
    const row = Array.isArray(stock) ? stock[0] : stock;
    if (
      !row ||
      row.available_quantity === undefined ||
      row.available_quantity === null
    ) {
      return null;
    }
    const value = Number(row.available_quantity);
    if (!Number.isFinite(value)) {
      return null;
    }
    return value;
  }

  private toCartItem(row: CartItemRow): CartItem {
    return parseOrThrow(cartItemSchema, {
      cart_item_id: row.cart_item_id,
      cart_id: row.cart_id,
      sku_id: row.sku_id,
      quantity: row.quantity,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  private toCartItemView(
    row: CartItemViewRow,
    unitPriceMinor: number,
    lineAmountMinor: number,
  ): CartItemView {
    const sku = row.sku!;
    const product = sku.product!;

    return {
      cart_item_id: row.cart_item_id,
      sku_id: row.sku_id,
      product_id: product.product_id,
      name: product.name,
      sku_code: sku.sku_code,
      pack_quantity: Number(sku.pack_quantity),
      pack_unit: sku.pack_unit,
      quantity: row.quantity,
      stock_available: this.readAvailableQuantity(sku.stock),
      unit_price_minor: unitPriceMinor,
      line_amount_minor: lineAmountMinor,
    };
  }
}
