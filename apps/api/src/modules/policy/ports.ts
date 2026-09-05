import type { PolicyReasonCode } from "./reason-codes.js";

/**
 * Narrow ports for Phase 2 Step 4 policy evaluation.
 * Real Basket/Optimization/Incentive domain entities are NOT invented here.
 */

/** Quantity-only line identity from the caller. Prices/categories are never trusted. */
export interface PolicyLineRequest {
  sku_id: string;
  quantity: number;
}

/**
 * Authoritative catalog snapshot for one SKU (backend-loaded only).
 * category_code comes from catalog category.code — never from the client/LLM.
 */
export interface AuthoritativeSkuSnapshot {
  sku_id: string;
  product_id: string;
  sku_status: string;
  product_status: string;
  category_code: string;
  price_minor: number;
  currency: string;
  /** null when no stock row exists — never invent availability. */
  available_quantity: number | null;
}

export interface PolicyCatalogPort {
  /**
   * Load authoritative SKU/product/category/stock for the given ids.
   * Missing SKUs are omitted from the result (caller fails closed).
   */
  loadSkuSnapshots(
    skuIds: readonly string[],
  ): Promise<AuthoritativeSkuSnapshot[]>;
}

export type IncentiveEvaluationResult =
  | { ok: true; discount_amount_minor: number }
  | { ok: false; reason_code: Extract<PolicyReasonCode, "INCENTIVE_INVALID"> };

/**
 * Authoritative incentive validation port (Doc 06 Rule 5).
 * Policy must not apply a discount unless this port confirms it.
 * Phase 5+ will implement real voucher/loyalty checks; until then adapters
 * must fail closed for any claimed incentive id.
 */
export interface IncentiveEvaluationContext {
  claimed_incentive_ids: readonly string[];
  /** Authoritative gross from catalog prices before incentive discount. */
  gross_amount_minor: number;
}

export interface IncentivePort {
  evaluate(
    input: IncentiveEvaluationContext,
  ): Promise<IncentiveEvaluationResult>;
}
