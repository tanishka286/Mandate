/**
 * Basket module DB row types — Phase 7.
 */

export type OptimizationRunRow = {
  optimization_run_id: string;
  session_id: string;
  intent_id: string | null;
  mandate_id: string | null;
  status: string;
  candidate_count: number;
  recommendation_json: unknown;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

export type BasketRow = {
  basket_id: string;
  optimization_run_id: string;
  session_id: string;
  user_id: string;
  basket_type: string;
  status: string;
  gross_amount_minor: number | string;
  discount_amount_minor: number | string;
  final_payable_minor: number | string;
  currency: string;
  quality_summary: string | null;
  recommendation_reason: string | null;
  explanation: string | null;
  combination_key: string | null;
  state_version: number;
  created_at: string;
  updated_at: string;
};

export type BasketItemRow = {
  basket_item_id: string;
  basket_id: string;
  requirement_id: string | null;
  sku_id: string;
  quantity: number;
  unit_price_minor: number | string;
  line_amount_minor: number | string;
  quality_level: string | null;
  evidence_refs_json: unknown;
  created_at: string;
  updated_at: string;
};

export type BasketSelectionRow = {
  selection_id: string;
  session_id: string;
  basket_id: string;
  user_id: string;
  selection_source: string;
  selected_at: string;
  superseded_at: string | null;
  created_at: string;
};

export type BasketQuoteRow = {
  quote_id: string;
  basket_id: string;
  session_id: string;
  user_id: string;
  selection_id: string | null;
  optimization_run_id: string;
  quote_version: string;
  basket_state_version: number;
  currency: string;
  amount_kind: string;
  gross_amount_minor: number | string;
  discount_amount_minor: number | string;
  final_payable_minor: number | string;
  lines_json: unknown;
  applied_incentives_json: unknown;
  catalog_fingerprint: string;
  incentive_fingerprint: string;
  status: string;
  request_id: string | null;
  created_at: string;
  superseded_at: string | null;
};

export type BasketIncentiveClaimRow = {
  incentive_id: string;
  kind: "VOUCHER" | "LOYALTY" | "MERCHANT_DEAL";
  decision: "USE_NOW" | "SAVE_FOR_LATER" | "DO_NOT_USE";
  validity: "VALID" | "EXPIRED" | "INVALID";
  eligibility: "ELIGIBLE" | "INELIGIBLE";
  benefit_minor: number;
  benefit_identity?: string;
  valid_until?: string | null;
};

export type CatalogSkuLoadRow = {
  sku_id: string;
  price_minor: number;
  currency: string;
  available_quantity: number | null;
  sku_status: string;
  product_status: string;
};
