import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type {
  BasketIncentiveClaimRow,
  BasketItemRow,
  BasketQuoteRow,
  BasketRow,
  BasketSelectionRow,
  CatalogSkuLoadRow,
  OptimizationRunRow,
} from "./types.js";

/**
 * Basket repository — Phase 7.
 * Persistence only. Ownership / stale / money authority live in BasketService.
 */
export class BasketRepository {
  async findOptimizationRunById(
    runId: string,
  ): Promise<OptimizationRunRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("optimization_run")
      .select(
        "optimization_run_id, session_id, intent_id, mandate_id, status, candidate_count, recommendation_json, started_at, completed_at, created_at",
      )
      .eq("optimization_run_id", runId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load optimization run");
    }
    return (data as OptimizationRunRow | null) ?? null;
  }

  async findLatestOptimizationRunForSession(
    sessionId: string,
  ): Promise<OptimizationRunRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("optimization_run")
      .select(
        "optimization_run_id, session_id, intent_id, mandate_id, status, candidate_count, recommendation_json, started_at, completed_at, created_at",
      )
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load latest optimization run");
    }
    return (data as OptimizationRunRow | null) ?? null;
  }

  async insertOptimizationRun(input: {
    optimization_run_id?: string;
    session_id: string;
    intent_id?: string | null;
    mandate_id?: string | null;
    status?: string;
    candidate_count?: number;
    recommendation_json?: unknown;
    started_at?: string;
    completed_at?: string | null;
  }): Promise<OptimizationRunRow> {
    const db = getSupabaseClient();
    const row: Record<string, unknown> = {
      session_id: input.session_id,
      intent_id: input.intent_id ?? null,
      mandate_id: input.mandate_id ?? null,
      status: input.status ?? "COMPLETED",
      candidate_count: input.candidate_count ?? 0,
      recommendation_json: input.recommendation_json ?? null,
      completed_at: input.completed_at ?? new Date().toISOString(),
    };
    if (input.optimization_run_id !== undefined) {
      row.optimization_run_id = input.optimization_run_id;
    }
    if (input.started_at !== undefined) {
      row.started_at = input.started_at;
    }

    const { data, error } = await db
      .from("optimization_run")
      .insert(row)
      .select(
        "optimization_run_id, session_id, intent_id, mandate_id, status, candidate_count, recommendation_json, started_at, completed_at, created_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert optimization run");
    }
    return data as OptimizationRunRow;
  }

  async supersedeCurrentBasketsForSession(sessionId: string): Promise<void> {
    const db = getSupabaseClient();
    const { error } = await db
      .from("basket")
      .update({
        status: "SUPERSEDED",
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId)
      .eq("status", "CURRENT");

    if (error) {
      throw mapDatabaseError(error, "Failed to supersede session baskets");
    }
  }

  async insertBasket(input: {
    basket_id?: string;
    optimization_run_id: string;
    session_id: string;
    user_id: string;
    basket_type: string;
    status?: string;
    gross_amount_minor?: number;
    discount_amount_minor?: number;
    final_payable_minor?: number;
    currency?: string;
    quality_summary?: string | null;
    recommendation_reason?: string | null;
    explanation?: string | null;
    combination_key?: string | null;
    state_version?: number;
  }): Promise<BasketRow> {
    const db = getSupabaseClient();
    const row: Record<string, unknown> = {
      optimization_run_id: input.optimization_run_id,
      session_id: input.session_id,
      user_id: input.user_id,
      basket_type: input.basket_type,
      status: input.status ?? "CURRENT",
      gross_amount_minor: input.gross_amount_minor ?? 0,
      discount_amount_minor: input.discount_amount_minor ?? 0,
      final_payable_minor: input.final_payable_minor ?? 0,
      currency: input.currency ?? "INR",
      quality_summary: input.quality_summary ?? null,
      recommendation_reason: input.recommendation_reason ?? null,
      explanation: input.explanation ?? null,
      combination_key: input.combination_key ?? null,
      state_version: input.state_version ?? 1,
    };
    if (input.basket_id !== undefined) {
      row.basket_id = input.basket_id;
    }

    const { data, error } = await db
      .from("basket")
      .insert(row)
      .select(
        "basket_id, optimization_run_id, session_id, user_id, basket_type, status, gross_amount_minor, discount_amount_minor, final_payable_minor, currency, quality_summary, recommendation_reason, explanation, combination_key, state_version, created_at, updated_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert basket");
    }
    return data as BasketRow;
  }

  async insertBasketItem(input: {
    basket_item_id?: string;
    basket_id: string;
    requirement_id?: string | null;
    sku_id: string;
    quantity: number;
    unit_price_minor?: number;
    line_amount_minor?: number;
    quality_level?: string | null;
    evidence_refs_json?: unknown;
  }): Promise<BasketItemRow> {
    const db = getSupabaseClient();
    const row: Record<string, unknown> = {
      basket_id: input.basket_id,
      requirement_id: input.requirement_id ?? null,
      sku_id: input.sku_id,
      quantity: input.quantity,
      unit_price_minor: input.unit_price_minor ?? 0,
      line_amount_minor: input.line_amount_minor ?? 0,
      quality_level: input.quality_level ?? null,
      evidence_refs_json: input.evidence_refs_json ?? [],
    };
    if (input.basket_item_id !== undefined) {
      row.basket_item_id = input.basket_item_id;
    }

    const { data, error } = await db
      .from("basket_item")
      .insert(row)
      .select(
        "basket_item_id, basket_id, requirement_id, sku_id, quantity, unit_price_minor, line_amount_minor, quality_level, evidence_refs_json, created_at, updated_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert basket item");
    }
    return data as BasketItemRow;
  }

  async findBasketById(basketId: string): Promise<BasketRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("basket")
      .select(
        "basket_id, optimization_run_id, session_id, user_id, basket_type, status, gross_amount_minor, discount_amount_minor, final_payable_minor, currency, quality_summary, recommendation_reason, explanation, combination_key, state_version, created_at, updated_at",
      )
      .eq("basket_id", basketId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load basket");
    }
    return (data as BasketRow | null) ?? null;
  }

  async listCurrentBasketsForSession(sessionId: string): Promise<BasketRow[]> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("basket")
      .select(
        "basket_id, optimization_run_id, session_id, user_id, basket_type, status, gross_amount_minor, discount_amount_minor, final_payable_minor, currency, quality_summary, recommendation_reason, explanation, combination_key, state_version, created_at, updated_at",
      )
      .eq("session_id", sessionId)
      .eq("status", "CURRENT")
      .order("basket_type", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to list session baskets");
    }
    return (data as BasketRow[]) ?? [];
  }

  async listBasketItems(basketId: string): Promise<BasketItemRow[]> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("basket_item")
      .select(
        "basket_item_id, basket_id, requirement_id, sku_id, quantity, unit_price_minor, line_amount_minor, quality_level, evidence_refs_json, created_at, updated_at",
      )
      .eq("basket_id", basketId)
      .order("sku_id", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to list basket items");
    }
    return (data as BasketItemRow[]) ?? [];
  }

  /**
   * Material basket mutation for stale-state tests / later edits.
   * Bumps state_version and replaces line quantities.
   */
  async replaceBasketItemQuantity(input: {
    basket_id: string;
    sku_id: string;
    quantity: number;
    next_state_version: number;
  }): Promise<BasketItemRow> {
    const db = getSupabaseClient();
    const now = new Date().toISOString();

    const { data: item, error: itemError } = await db
      .from("basket_item")
      .update({
        quantity: input.quantity,
        updated_at: now,
      })
      .eq("basket_id", input.basket_id)
      .eq("sku_id", input.sku_id)
      .select(
        "basket_item_id, basket_id, requirement_id, sku_id, quantity, unit_price_minor, line_amount_minor, quality_level, evidence_refs_json, created_at, updated_at",
      )
      .single();

    if (itemError) {
      throw mapDatabaseError(itemError, "Failed to update basket item");
    }

    const { error: basketError } = await db
      .from("basket")
      .update({
        state_version: input.next_state_version,
        updated_at: now,
      })
      .eq("basket_id", input.basket_id);

    if (basketError) {
      throw mapDatabaseError(basketError, "Failed to bump basket state_version");
    }

    return item as BasketItemRow;
  }

  async findActiveSelectionForSession(
    sessionId: string,
  ): Promise<BasketSelectionRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("basket_selection")
      .select(
        "selection_id, session_id, basket_id, user_id, selection_source, selected_at, superseded_at, created_at",
      )
      .eq("session_id", sessionId)
      .is("superseded_at", null)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load active basket selection");
    }
    return (data as BasketSelectionRow | null) ?? null;
  }

  async supersedeSelection(
    selectionId: string,
    supersededAt: string,
  ): Promise<BasketSelectionRow> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("basket_selection")
      .update({ superseded_at: supersededAt })
      .eq("selection_id", selectionId)
      .select(
        "selection_id, session_id, basket_id, user_id, selection_source, selected_at, superseded_at, created_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to supersede basket selection");
    }
    return data as BasketSelectionRow;
  }

  async insertSelection(input: {
    selection_id?: string;
    session_id: string;
    basket_id: string;
    user_id: string;
    selection_source: string;
    selected_at?: string;
  }): Promise<BasketSelectionRow> {
    const db = getSupabaseClient();
    const row: Record<string, unknown> = {
      session_id: input.session_id,
      basket_id: input.basket_id,
      user_id: input.user_id,
      selection_source: input.selection_source,
      selected_at: input.selected_at ?? new Date().toISOString(),
      superseded_at: null,
    };
    if (input.selection_id !== undefined) {
      row.selection_id = input.selection_id;
    }

    const { data, error } = await db
      .from("basket_selection")
      .insert(row)
      .select(
        "selection_id, session_id, basket_id, user_id, selection_source, selected_at, superseded_at, created_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert basket selection");
    }
    return data as BasketSelectionRow;
  }

  async findQuoteByBasketAndVersion(
    basketId: string,
    quoteVersion: string,
  ): Promise<BasketQuoteRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("basket_quote")
      .select(
        "quote_id, basket_id, session_id, user_id, selection_id, optimization_run_id, quote_version, basket_state_version, currency, amount_kind, gross_amount_minor, discount_amount_minor, final_payable_minor, lines_json, applied_incentives_json, catalog_fingerprint, incentive_fingerprint, status, request_id, created_at, superseded_at",
      )
      .eq("basket_id", basketId)
      .eq("quote_version", quoteVersion)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load basket quote");
    }
    return (data as BasketQuoteRow | null) ?? null;
  }

  async findCurrentQuoteForBasket(
    basketId: string,
  ): Promise<BasketQuoteRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("basket_quote")
      .select(
        "quote_id, basket_id, session_id, user_id, selection_id, optimization_run_id, quote_version, basket_state_version, currency, amount_kind, gross_amount_minor, discount_amount_minor, final_payable_minor, lines_json, applied_incentives_json, catalog_fingerprint, incentive_fingerprint, status, request_id, created_at, superseded_at",
      )
      .eq("basket_id", basketId)
      .eq("status", "CURRENT")
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load current basket quote");
    }
    return (data as BasketQuoteRow | null) ?? null;
  }

  async markQuotesStaleOrSuperseded(
    basketId: string,
    status: "SUPERSEDED" | "STALE",
  ): Promise<void> {
    const db = getSupabaseClient();
    const { error } = await db
      .from("basket_quote")
      .update({
        status,
        superseded_at: new Date().toISOString(),
      })
      .eq("basket_id", basketId)
      .eq("status", "CURRENT");

    if (error) {
      throw mapDatabaseError(error, "Failed to update basket quotes");
    }
  }

  async insertQuote(input: {
    quote_id?: string;
    basket_id: string;
    session_id: string;
    user_id: string;
    selection_id?: string | null;
    optimization_run_id: string;
    quote_version: string;
    basket_state_version: number;
    currency?: string;
    amount_kind?: string;
    gross_amount_minor: number;
    discount_amount_minor: number;
    final_payable_minor: number;
    lines_json: unknown;
    applied_incentives_json?: unknown;
    catalog_fingerprint: string;
    incentive_fingerprint: string;
    status?: string;
    request_id?: string | null;
  }): Promise<BasketQuoteRow> {
    const db = getSupabaseClient();
    const row: Record<string, unknown> = {
      basket_id: input.basket_id,
      session_id: input.session_id,
      user_id: input.user_id,
      selection_id: input.selection_id ?? null,
      optimization_run_id: input.optimization_run_id,
      quote_version: input.quote_version,
      basket_state_version: input.basket_state_version,
      currency: input.currency ?? "INR",
      amount_kind: input.amount_kind ?? "AUTHORITATIVE_QUOTE",
      gross_amount_minor: input.gross_amount_minor,
      discount_amount_minor: input.discount_amount_minor,
      final_payable_minor: input.final_payable_minor,
      lines_json: input.lines_json,
      applied_incentives_json: input.applied_incentives_json ?? [],
      catalog_fingerprint: input.catalog_fingerprint,
      incentive_fingerprint: input.incentive_fingerprint,
      status: input.status ?? "CURRENT",
      request_id: input.request_id ?? null,
    };
    if (input.quote_id !== undefined) {
      row.quote_id = input.quote_id;
    }

    const { data, error } = await db
      .from("basket_quote")
      .insert(row)
      .select(
        "quote_id, basket_id, session_id, user_id, selection_id, optimization_run_id, quote_version, basket_state_version, currency, amount_kind, gross_amount_minor, discount_amount_minor, final_payable_minor, lines_json, applied_incentives_json, catalog_fingerprint, incentive_fingerprint, status, request_id, created_at, superseded_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert basket quote");
    }
    return data as BasketQuoteRow;
  }

  /**
   * Load authoritative catalog snapshots for quote calculation.
   */
  async loadCatalogSnapshots(
    skuIds: readonly string[],
  ): Promise<CatalogSkuLoadRow[]> {
    if (skuIds.length === 0) {
      return [];
    }

    const uniqueIds = [...new Set(skuIds)];
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("sku")
      .select(
        `
        sku_id,
        status,
        price_minor,
        currency,
        product (
          status
        ),
        stock (
          available_quantity
        )
      `,
      )
      .in("sku_id", uniqueIds);

    if (error) {
      throw mapDatabaseError(error, "Failed to load catalog for quote");
    }

    const rows = (data ?? []) as unknown as Array<{
      sku_id: string;
      status: string;
      price_minor: number | string;
      currency: string;
      product:
        | { status: string }
        | { status: string }[]
        | null;
      stock:
        | { available_quantity: number | string }
        | { available_quantity: number | string }[]
        | null;
    }>;

    return rows.map((row) => {
      const product = Array.isArray(row.product) ? row.product[0] : row.product;
      const stockRaw = row.stock;
      const stock = Array.isArray(stockRaw) ? stockRaw[0] : stockRaw;
      let available_quantity: number | null = null;
      if (
        stock &&
        stock.available_quantity !== undefined &&
        stock.available_quantity !== null
      ) {
        const value = Number(stock.available_quantity);
        available_quantity = Number.isFinite(value) ? value : null;
      }

      return {
        sku_id: row.sku_id,
        price_minor: Number(row.price_minor),
        currency: row.currency,
        available_quantity,
        sku_status: row.status,
        product_status: product?.status ?? "INACTIVE",
      };
    });
  }

  /**
   * Incentive claims are stored on optimization_run.recommendation_json.incentive_claims
   * for Phase 7 (full incentive_evaluation table deferred).
   */
  extractIncentiveClaims(
    recommendationJson: unknown,
  ): BasketIncentiveClaimRow[] {
    if (
      !recommendationJson ||
      typeof recommendationJson !== "object" ||
      !("incentive_claims" in recommendationJson)
    ) {
      return [];
    }
    const claims = (recommendationJson as { incentive_claims?: unknown })
      .incentive_claims;
    if (!Array.isArray(claims)) {
      return [];
    }
    return claims as BasketIncentiveClaimRow[];
  }
}
