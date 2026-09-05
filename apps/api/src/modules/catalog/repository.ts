import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type {
  CatalogSearchRow,
  CategoryRow,
  ProductWithCategoryRow,
  SkuInsertInput,
  SkuRow,
  StockInsertInput,
  StockRow,
} from "./types.js";

/**
 * Catalog repository — Category + Product + SKU + Stock + Search (Phase 1 Steps 1–5).
 * Communicates with Supabase via the centralized client. No business logic.
 */
export class CatalogRepository {
  async listCategories(): Promise<CategoryRow[]> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("category")
      .select("category_id, code, name, created_at, updated_at")
      .order("code", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to load categories");
    }

    return (data ?? []) as CategoryRow[];
  }

  async getProductWithCategory(
    productId: string,
  ): Promise<ProductWithCategoryRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("product")
      .select(
        `
        product_id,
        name,
        description,
        category_id,
        brand,
        status,
        created_at,
        updated_at,
        category:category_id (
          category_id,
          code,
          name,
          created_at,
          updated_at
        )
      `,
      )
      .eq("product_id", productId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load product");
    }

    if (!data) {
      return null;
    }

    return data as unknown as ProductWithCategoryRow;
  }

  /** ACTIVE SKUs for a product, ordered by sku_code ascending. */
  async listActiveSkusByProductId(productId: string): Promise<SkuRow[]> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("sku")
      .select(
        `
        sku_id,
        product_id,
        sku_code,
        pack_quantity,
        pack_unit,
        price_minor,
        currency,
        status,
        created_at,
        updated_at
      `,
      )
      .eq("product_id", productId)
      .eq("status", "ACTIVE")
      .order("sku_code", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to load product SKUs");
    }

    return (data ?? []) as SkuRow[];
  }

  /** Authoritative stock rows for the given SKU ids. Never invents missing rows. */
  async listStockBySkuIds(skuIds: string[]): Promise<StockRow[]> {
    if (skuIds.length === 0) {
      return [];
    }

    const db = getSupabaseClient();
    const { data, error } = await db
      .from("stock")
      .select("sku_id, available_quantity, updated_at")
      .in("sku_id", skuIds);

    if (error) {
      throw mapDatabaseError(error, "Failed to load stock");
    }

    return (data ?? []) as StockRow[];
  }

  /**
   * Persist a SKU row (used for integrity/round-trip tests; not exposed via HTTP).
   * Database constraints remain authoritative for uniqueness and FK checks.
   */
  async insertSku(input: SkuInsertInput): Promise<SkuRow> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("sku")
      .insert({
        sku_id: input.sku_id,
        product_id: input.product_id,
        sku_code: input.sku_code,
        pack_quantity: input.pack_quantity,
        pack_unit: input.pack_unit,
        price_minor: input.price_minor,
        currency: input.currency ?? "INR",
        status: input.status ?? "ACTIVE",
      })
      .select(
        `
        sku_id,
        product_id,
        sku_code,
        pack_quantity,
        pack_unit,
        price_minor,
        currency,
        status,
        created_at,
        updated_at
      `,
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert SKU");
    }

    return data as SkuRow;
  }

  /**
   * Persist a stock row (integrity/round-trip tests only; not an HTTP mutation API).
   */
  async insertStock(input: StockInsertInput): Promise<StockRow> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("stock")
      .insert({
        sku_id: input.sku_id,
        available_quantity: input.available_quantity,
      })
      .select("sku_id, available_quantity, updated_at")
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert stock");
    }

    return data as StockRow;
  }

  /**
   * Authoritative catalog search over ACTIVE products and ACTIVE SKUs.
   * Stock is left-joined; missing stock rows are returned as null (never invented).
   */
  async searchCatalog(params: {
    q?: string;
    categoryCode?: string;
    limit: number;
  }): Promise<CatalogSearchRow[]> {
    const db = getSupabaseClient();

    let query = db
      .from("sku")
      .select(
        `
        sku_id,
        sku_code,
        pack_quantity,
        pack_unit,
        price_minor,
        currency,
        status,
        product!inner (
          product_id,
          name,
          status,
          category!inner (
            code
          )
        ),
        stock (
          available_quantity
        )
      `,
      )
      .eq("status", "ACTIVE")
      .eq("product.status", "ACTIVE");

    if (params.q) {
      // Parameterized ilike via Supabase client (no raw string interpolation into SQL).
      query = query.ilike("product.name", `%${params.q}%`);
    }

    if (params.categoryCode) {
      query = query.eq("product.category.code", params.categoryCode);
    }

    const { data, error } = await query
      .order("sku_code", { ascending: true })
      .limit(params.limit);

    if (error) {
      throw mapDatabaseError(error, "Failed to search catalog");
    }

    return (data ?? []) as unknown as CatalogSearchRow[];
  }
}
