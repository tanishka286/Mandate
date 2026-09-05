import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type { AuthoritativeSkuSnapshot, PolicyCatalogPort } from "./ports.js";

/**
 * Loads authoritative catalog state for policy checks.
 * Does not invent stock or trust client/LLM category labels.
 */
export class SupabasePolicyCatalogAdapter implements PolicyCatalogPort {
  async loadSkuSnapshots(
    skuIds: readonly string[],
  ): Promise<AuthoritativeSkuSnapshot[]> {
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
        product_id,
        status,
        price_minor,
        currency,
        product (
          product_id,
          status,
          category (
            code
          )
        ),
        stock (
          available_quantity
        )
      `,
      )
      .in("sku_id", uniqueIds);

    if (error) {
      throw mapDatabaseError(error, "Failed to load catalog state for policy");
    }

    const rows = (data ?? []) as unknown as Array<{
      sku_id: string;
      product_id: string;
      status: string;
      price_minor: number | string;
      currency: string;
      product:
        | {
            product_id: string;
            status: string;
            category: { code: string } | { code: string }[] | null;
          }
        | {
            product_id: string;
            status: string;
            category: { code: string } | { code: string }[] | null;
          }[]
        | null;
      stock:
        | { available_quantity: number | string }
        | { available_quantity: number | string }[]
        | null;
    }>;

    return rows.map((row) => {
      const product = Array.isArray(row.product) ? row.product[0] : row.product;
      const categoryRaw = product?.category ?? null;
      const category = Array.isArray(categoryRaw)
        ? categoryRaw[0]
        : categoryRaw;
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
        product_id: row.product_id,
        sku_status: row.status,
        product_status: product?.status ?? "INACTIVE",
        category_code: category?.code ?? "",
        price_minor: Number(row.price_minor),
        currency: row.currency,
        available_quantity,
      };
    });
  }
}
