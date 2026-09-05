import type {
  AddCartItemBody,
  ApplicationOrder,
  ApplicationOrderStatus,
  Cart,
  CartData,
  CartItem,
  CartItemView,
  CartStatus,
  CartWithItems,
  UpdateCartItemBody,
} from "./schema.js";

export type {
  AddCartItemBody,
  ApplicationOrder,
  ApplicationOrderStatus,
  Cart,
  CartData,
  CartItem,
  CartItemView,
  CartStatus,
  CartWithItems,
  UpdateCartItemBody,
};

/** Row shape returned from Supabase `cart` table. */
export interface CartRow {
  cart_id: string;
  user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Row shape returned from Supabase `cart_item` table. */
export interface CartItemRow {
  cart_item_id: string;
  cart_id: string;
  sku_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

/** Insert payload for cart persistence / uniqueness tests (not an HTTP create API). */
export interface CartInsertInput {
  cart_id?: string;
  user_id: string;
  status?: string;
}

export interface CartItemInsertInput {
  cart_item_id?: string;
  cart_id: string;
  sku_id: string;
  quantity: number;
}

/** Joined cart-item view for GET /cart (includes authoritative price). */
export interface CartItemViewRow {
  cart_item_id: string;
  cart_id: string;
  sku_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
  sku: {
    sku_id: string;
    sku_code: string;
    pack_quantity: number | string;
    pack_unit: string;
    price_minor: number | string;
    currency: string;
    status: string;
    product_id: string;
    product: {
      product_id: string;
      name: string;
      status: string;
    } | null;
    stock:
      | { available_quantity: number | string }
      | { available_quantity: number | string }[]
      | null;
  } | null;
}

/** SKU eligibility snapshot for cart mutations. */
export interface SkuEligibilityRow {
  sku_id: string;
  sku_code: string;
  status: string;
  product_id: string;
  product: {
    product_id: string;
    name: string;
    status: string;
  } | null;
  stock:
    | { available_quantity: number | string }
    | { available_quantity: number | string }[]
    | null;
}
