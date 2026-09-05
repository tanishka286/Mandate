import { z } from "zod";
import { CART_PRICING_CURRENCY } from "./pricing.js";

/** Accepts UTC ISO timestamps from Postgres/Supabase (including fractional seconds). */
const isoUtcTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

/** Cart lifecycle / Phase 1 application order statuses (no payment states). */
export const CART_STATUSES = ["OPEN_CART", "CANCELLED"] as const;

export type CartStatus = (typeof CART_STATUSES)[number];

export const cartStatusSchema = z.enum(CART_STATUSES);

/**
 * Phase 1 application order state is persisted as cart.status.
 * Alias kept for explicit order-state vocabulary in tests/docs.
 */
export const APPLICATION_ORDER_STATUSES = CART_STATUSES;
export type ApplicationOrderStatus = CartStatus;
export const applicationOrderStatusSchema = cartStatusSchema;

export const cartIdSchema = z.string().uuid();

export const userIdSchema = z.string().uuid();

export const cartItemIdSchema = z.string().uuid();

export const skuIdSchema = z.string().uuid();

/** Positive integer cart quantity (not money, not pack DECIMAL). */
export const cartQuantitySchema = z
  .number({
    invalid_type_error: "quantity must be an integer",
  })
  .int("quantity must be an integer")
  .min(1, "quantity must be >= 1");

/** Integer minor-unit money (paise). */
export const moneyMinorSchema = z
  .number({
    invalid_type_error: "money must be an integer minor-unit amount",
  })
  .int("money must be an integer minor-unit amount")
  .nonnegative("money must be >= 0");

export const cartCurrencySchema = z.literal(CART_PRICING_CURRENCY);

export const cartSchema = z.object({
  cart_id: cartIdSchema,
  user_id: userIdSchema,
  status: cartStatusSchema,
  created_at: isoUtcTimestampSchema,
  updated_at: isoUtcTimestampSchema,
});

export type Cart = z.infer<typeof cartSchema>;

/**
 * Application order record for Phase 1 = cart row.
 * Same shape; naming clarifies the Decision Log interpretation.
 */
export const applicationOrderSchema = cartSchema;
export type ApplicationOrder = Cart;

export const cartItemSchema = z.object({
  cart_item_id: cartItemIdSchema,
  cart_id: cartIdSchema,
  sku_id: skuIdSchema,
  quantity: cartQuantitySchema,
  created_at: isoUtcTimestampSchema,
  updated_at: isoUtcTimestampSchema,
});

export type CartItem = z.infer<typeof cartItemSchema>;

/**
 * Cart line for GET /cart — identity + quantity + stock + authoritative line pricing.
 * Totals live on the cart; line amounts come from current sku.price_minor only.
 */
export const cartItemViewSchema = z.object({
  cart_item_id: cartItemIdSchema,
  sku_id: skuIdSchema,
  product_id: z.string().uuid(),
  name: z.string().min(1),
  sku_code: z.string().min(1),
  pack_quantity: z.number().finite().positive(),
  pack_unit: z.string().min(1),
  quantity: cartQuantitySchema,
  stock_available: z.number().finite().nonnegative().nullable(),
  unit_price_minor: moneyMinorSchema,
  line_amount_minor: moneyMinorSchema,
});

export type CartItemView = z.infer<typeof cartItemViewSchema>;

/**
 * Active cart with items and server-side pricing.
 * discount_amount_minor is always 0 in Phase 1 Step 8.
 */
export const cartWithItemsSchema = cartSchema.extend({
  items: z.array(cartItemViewSchema),
  gross_amount_minor: moneyMinorSchema,
  discount_amount_minor: moneyMinorSchema,
  final_payable_minor: moneyMinorSchema,
  currency: cartCurrencySchema,
});

export type CartWithItems = z.infer<typeof cartWithItemsSchema>;

export const addCartItemBodySchema = z
  .object({
    sku_id: skuIdSchema,
    quantity: cartQuantitySchema,
  })
  .strict();

export type AddCartItemBody = z.infer<typeof addCartItemBodySchema>;

export const updateCartItemBodySchema = z
  .object({
    quantity: cartQuantitySchema,
  })
  .strict();

export type UpdateCartItemBody = z.infer<typeof updateCartItemBodySchema>;

export const cartItemParamsSchema = z.object({
  cart_item_id: cartItemIdSchema,
});

/** Active cart response — ownership + items + authoritative pricing. */
export const cartDataSchema = cartWithItemsSchema;

export type CartData = z.infer<typeof cartDataSchema>;
