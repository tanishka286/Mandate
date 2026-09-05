/**
 * Shared API contract types for Mandate.
 * Phase 0 envelopes + Phase 1 Steps 1–9 (Commerce Core complete).
 */

export interface ApiMeta {
  request_id: string;
}

export interface ApiSuccessResponse<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  request_id: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export interface HealthData {
  status: "ok";
}

/** Money is always integer minor units (paise for INR). ₹1 = 100. */
export type MoneyMinor = number;

export type IsoUtcTimestamp = string;

/** Controlled MVP category codes (Phase 1 Step 1). */
export type CategoryCode =
  | "dairy"
  | "pantry"
  | "produce"
  | "beverages"
  | "household";

export interface Category {
  category_id: string;
  code: CategoryCode;
  name: string;
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

export interface CategoryListData {
  categories: Category[];
}

/** Controlled product statuses (Phase 1 Step 2). */
export type ProductStatus = "ACTIVE" | "INACTIVE";

/** Product catalog identity — no price or stock fields. */
export interface Product {
  product_id: string;
  name: string;
  description: string;
  category_id: string;
  brand: string | null;
  status: ProductStatus;
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

/** Controlled SKU statuses (Phase 1 Step 3). Distinct from Stock. */
export type SkuStatus = "ACTIVE" | "INACTIVE";

/** Purchasable pack variant with authoritative backend price. */
export interface Sku {
  sku_id: string;
  product_id: string;
  sku_code: string;
  pack_quantity: number;
  pack_unit: string;
  price_minor: MoneyMinor;
  currency: "INR";
  status: SkuStatus;
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

/** Nested stock availability from the stock table (never invented). */
export interface StockAvailability {
  available_quantity: number;
}

export interface SkuWithStock extends Sku {
  /** null when no stock row exists for the SKU. */
  stock: StockAvailability | null;
}

export interface ProductDetail extends Product {
  category: Category;
  skus: SkuWithStock[];
}

/** Catalog search hit (Product × ACTIVE SKU × Stock). */
export interface CatalogSearchItem {
  product_id: string;
  sku_id: string;
  name: string;
  sku_code: string;
  pack_quantity: number;
  pack_unit: string;
  price_minor: MoneyMinor;
  currency: "INR";
  /** null when no stock row exists; 0 means out of stock. */
  stock_available: number | null;
}

export interface CatalogSearchResult {
  items: CatalogSearchItem[];
}

/** Cart lifecycle / Phase 1 application order statuses. */
export type CartStatus = "OPEN_CART" | "CANCELLED";

/** Alias: Phase 1 application order state is cart.status. */
export type ApplicationOrderStatus = CartStatus;

/** Cart line identity + quantity (no price/totals). */
export interface CartItem {
  cart_item_id: string;
  cart_id: string;
  sku_id: string;
  quantity: number;
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

/**
 * Cart line for GET /cart — catalog identity + quantity + stock + line pricing.
 * Line amounts come from current authoritative sku.price_minor only.
 */
export interface CartItemView {
  cart_item_id: string;
  sku_id: string;
  product_id: string;
  name: string;
  sku_code: string;
  pack_quantity: number;
  pack_unit: string;
  quantity: number;
  /** null when no stock row exists; 0 means out of stock. */
  stock_available: number | null;
  unit_price_minor: MoneyMinor;
  line_amount_minor: MoneyMinor;
}

/**
 * Active cart with items and server-side pricing.
 * discount_amount_minor is always 0 until the incentive layer exists.
 */
export interface Cart {
  cart_id: string;
  user_id: string;
  status: CartStatus;
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
  items: CartItemView[];
  gross_amount_minor: MoneyMinor;
  discount_amount_minor: MoneyMinor;
  final_payable_minor: MoneyMinor;
  currency: "INR";
}

/** Phase 7 basket types (locked MVP). */
export type BasketType = "BEST_VALUE" | "BEST_QUALITY";

export interface BasketItemView {
  basket_item_id: string;
  basket_id: string;
  requirement_id: string | null;
  sku_id: string;
  quantity: number;
  unit_price_minor: MoneyMinor;
  line_amount_minor: MoneyMinor;
  quality_level: string | null;
  evidence_refs_json: unknown[];
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

/** Planning snapshot basket — not payment authority. */
export interface BasketView {
  basket_id: string;
  optimization_run_id: string;
  session_id: string;
  user_id: string;
  basket_type: BasketType;
  status: "CURRENT" | "SUPERSEDED";
  gross_amount_minor: MoneyMinor;
  discount_amount_minor: MoneyMinor;
  final_payable_minor: MoneyMinor;
  currency: "INR";
  quality_summary: string | null;
  recommendation_reason: string | null;
  explanation: string | null;
  combination_key: string | null;
  state_version: number;
  items: BasketItemView[];
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

export interface BasketSelectionData {
  selection_id: string;
  session_id: string;
  basket_id: string;
  selection_source: "USER";
  status: "SELECTED";
  selected_at: IsoUtcTimestamp;
  superseded_at: IsoUtcTimestamp | null;
  created_at: IsoUtcTimestamp;
  order_created: false;
  payment_created: false;
  policy_decision: null;
}

export interface BasketQuoteLine {
  sku_id: string;
  quantity: number;
  unit_price_minor: MoneyMinor;
  line_amount_minor: MoneyMinor;
}

export interface BasketQuoteData {
  quote_id: string;
  basket_id: string;
  session_id: string;
  selection_id: string | null;
  optimization_run_id: string;
  currency: "INR";
  amount_kind: "AUTHORITATIVE_QUOTE";
  gross_amount_minor: MoneyMinor;
  discount_amount_minor: MoneyMinor;
  final_payable_minor: MoneyMinor;
  quote_version: string;
  basket_state_version: number;
  lines: BasketQuoteLine[];
  applied_incentives: Array<{
    incentive_id: string;
    kind: "VOUCHER" | "LOYALTY" | "MERCHANT_DEAL";
    benefit_minor: MoneyMinor;
  }>;
  catalog_fingerprint: string;
  incentive_fingerprint: string;
  policy_decision: null;
  payment_created: false;
  order_created: false;
}

export interface SessionBasketsData {
  session_id: string;
  optimization_run_id: string | null;
  best_value: BasketView | null;
  best_quality: BasketView | null;
  recommendation: {
    recommended_basket_type: BasketType | null;
    recommended_basket_id: string | null;
    reason: string | null;
    tradeoff_summary: string | null;
    user_may_select_alternative: true;
  } | null;
  active_selection: Omit<
    BasketSelectionData,
    "order_created" | "payment_created" | "policy_decision"
  > | null;
}

/** Phase 8 canonical order states. */
export type OrderState =
  | "CREATED"
  | "PAYMENT_PENDING"
  | "PAYMENT_VERIFIED"
  | "PAYMENT_FAILED"
  | "PAYMENT_CANCELLED"
  | "PAYMENT_EXPIRED";

/** Phase 8 canonical payment states. */
export type PaymentState =
  | "PAYMENT_PENDING"
  | "VERIFIED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

/** Phase 8 Razorpay webhook processing states. */
export type WebhookProcessingStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "PROCESSED"
  | "FAILED"
  | "IGNORED";

/** Phase 8 canonical application Order. */
export interface Order {
  order_id: string;
  user_id: string;
  session_id: string;
  mandate_id: string;
  basket_id: string;
  policy_decision_id: string;
  status: OrderState;
  gross_amount_minor: MoneyMinor;
  discount_amount_minor: MoneyMinor;
  final_payable_minor: MoneyMinor;
  currency: "INR";
  razorpay_order_id: string | null;
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

/** Phase 8 canonical Payment entity. */
export interface Payment {
  payment_id: string;
  order_id: string;
  razorpay_payment_id: string | null;
  status: PaymentState;
  amount_minor: MoneyMinor;
  currency: "INR";
  method: string | null;
  verified_at: IsoUtcTimestamp | null;
  failure_code: string | null;
  metadata_json: Record<string, unknown>;
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

/** Phase 8 durable checkout idempotency record. */
export interface CheckoutIdempotencyRecord {
  idempotency_id: string;
  user_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  order_id: string | null;
  response_json: Record<string, unknown> | null;
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

/** Phase 8 durable Razorpay webhook event record. */
export interface RazorpayWebhookEventRecord {
  webhook_event_id: string;
  event_id: string;
  event_type: string;
  payload_hash: string | null;
  received_at: IsoUtcTimestamp;
  processed_at: IsoUtcTimestamp | null;
  processing_status: WebhookProcessingStatus;
  error_code: string | null;
  payload_json: Record<string, unknown> | null;
  created_at: IsoUtcTimestamp;
  updated_at: IsoUtcTimestamp;
}

/** Phase 8 checkout service result for frontend/API handoff. */
export interface CheckoutResult {
  order_id: string;
  razorpay_order_id: string;
  amount_minor: MoneyMinor;
  currency: "INR";
  razorpay_key_id: string;
  status: "PAYMENT_PENDING";
  policy_decision_id: string;
  quote_version: string;
  request_id: string;
}
