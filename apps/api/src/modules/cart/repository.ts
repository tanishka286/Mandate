import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type {
  CartInsertInput,
  CartItemInsertInput,
  CartItemRow,
  CartItemViewRow,
  CartRow,
  SkuEligibilityRow,
} from "./types.js";

/**
 * Cart repository — Phase 1 Steps 6–9 (cart + items + pricing reads + order state).
 * Communicates with Supabase via the centralized client. No business logic.
 */
export class CartRepository {
  async findOpenCartByUserId(userId: string): Promise<CartRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("cart")
      .select("cart_id, user_id, status, created_at, updated_at")
      .eq("user_id", userId)
      .eq("status", "OPEN_CART")
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load cart");
    }

    return (data as CartRow | null) ?? null;
  }

  async findCartById(cartId: string): Promise<CartRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("cart")
      .select("cart_id, user_id, status, created_at, updated_at")
      .eq("cart_id", cartId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load cart");
    }

    return (data as CartRow | null) ?? null;
  }

  /**
   * Persist a cart row (integrity/uniqueness tests only; not an HTTP create API).
   */
  async insertCart(input: CartInsertInput): Promise<CartRow> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("cart")
      .insert({
        cart_id: input.cart_id,
        user_id: input.user_id,
        status: input.status ?? "OPEN_CART",
      })
      .select("cart_id, user_id, status, created_at, updated_at")
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert cart");
    }

    return data as CartRow;
  }

  /**
   * Persist application order state transition on cart.status.
   * Callers must validate transitions via order-state helpers first.
   */
  async updateCartStatus(
    cartId: string,
    status: string,
  ): Promise<CartRow> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("cart")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("cart_id", cartId)
      .select("cart_id, user_id, status, created_at, updated_at")
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to update cart status");
    }

    return data as CartRow;
  }

  /** Cart lines for GET /cart, joined to authoritative SKU/Product/Stock. */
  async listCartItemsWithCatalog(cartId: string): Promise<CartItemViewRow[]> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("cart_item")
      .select(
        `
        cart_item_id,
        cart_id,
        sku_id,
        quantity,
        created_at,
        updated_at,
        sku (
          sku_id,
          sku_code,
          pack_quantity,
          pack_unit,
          price_minor,
          currency,
          status,
          product_id,
          product (
            product_id,
            name,
            status
          ),
          stock (
            available_quantity
          )
        )
      `,
      )
      .eq("cart_id", cartId)
      .order("created_at", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to load cart items");
    }

    return (data ?? []) as unknown as CartItemViewRow[];
  }

  async findCartItemById(cartItemId: string): Promise<
    | (CartItemRow & {
        cart: { cart_id: string; user_id: string; status: string } | null;
      })
    | null
  > {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("cart_item")
      .select(
        `
        cart_item_id,
        cart_id,
        sku_id,
        quantity,
        created_at,
        updated_at,
        cart (
          cart_id,
          user_id,
          status
        )
      `,
      )
      .eq("cart_item_id", cartItemId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load cart item");
    }

    return data as unknown as
      | (CartItemRow & {
          cart: { cart_id: string; user_id: string; status: string } | null;
        })
      | null;
  }

  async findCartItemByCartAndSku(
    cartId: string,
    skuId: string,
  ): Promise<CartItemRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("cart_item")
      .select(
        "cart_item_id, cart_id, sku_id, quantity, created_at, updated_at",
      )
      .eq("cart_id", cartId)
      .eq("sku_id", skuId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load cart item");
    }

    return (data as CartItemRow | null) ?? null;
  }

  /**
   * SKU eligibility snapshot: status, parent product status, current stock.
   * Missing stock rows are returned as null — never invented.
   */
  async getSkuEligibility(skuId: string): Promise<SkuEligibilityRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("sku")
      .select(
        `
        sku_id,
        sku_code,
        status,
        product_id,
        product (
          product_id,
          name,
          status
        ),
        stock (
          available_quantity
        )
      `,
      )
      .eq("sku_id", skuId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load SKU");
    }

    return (data as unknown as SkuEligibilityRow | null) ?? null;
  }

  async insertCartItem(input: CartItemInsertInput): Promise<CartItemRow> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("cart_item")
      .insert({
        cart_item_id: input.cart_item_id,
        cart_id: input.cart_id,
        sku_id: input.sku_id,
        quantity: input.quantity,
      })
      .select(
        "cart_item_id, cart_id, sku_id, quantity, created_at, updated_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert cart item");
    }

    return data as CartItemRow;
  }

  async updateCartItemQuantity(
    cartItemId: string,
    quantity: number,
  ): Promise<CartItemRow> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("cart_item")
      .update({
        quantity,
        updated_at: new Date().toISOString(),
      })
      .eq("cart_item_id", cartItemId)
      .select(
        "cart_item_id, cart_id, sku_id, quantity, created_at, updated_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to update cart item");
    }

    return data as CartItemRow;
  }

  async deleteCartItem(cartItemId: string): Promise<void> {
    const db = getSupabaseClient();
    const { error } = await db
      .from("cart_item")
      .delete()
      .eq("cart_item_id", cartItemId);

    if (error) {
      throw mapDatabaseError(error, "Failed to delete cart item");
    }
  }
}
