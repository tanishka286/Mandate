import type {
  CatalogSearchItem,
  CatalogSearchQuery,
  CatalogSearchResult,
  Category,
  CategoryCode,
  Product,
  ProductDetail,
  ProductStatus,
  Sku,
  SkuStatus,
  SkuWithStock,
  Stock,
  StockAvailability,
} from "./schema.js";

export type {
  CatalogSearchItem,
  CatalogSearchQuery,
  CatalogSearchResult,
  Category,
  CategoryCode,
  Product,
  ProductDetail,
  ProductStatus,
  Sku,
  SkuStatus,
  SkuWithStock,
  Stock,
  StockAvailability,
};

/** Row shape returned from Supabase `category` table. */
export interface CategoryRow {
  category_id: string;
  code: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CategoryListData {
  categories: Category[];
}

/** Row shape returned from Supabase `product` table (identity only). */
export interface ProductRow {
  product_id: string;
  name: string;
  description: string;
  category_id: string;
  brand: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Joined product + category row from Supabase embed. */
export interface ProductWithCategoryRow extends ProductRow {
  category: CategoryRow;
}

/** Row shape returned from Supabase `sku` table. */
export interface SkuRow {
  sku_id: string;
  product_id: string;
  sku_code: string;
  pack_quantity: number | string;
  pack_unit: string;
  price_minor: number;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Row shape returned from Supabase `stock` table. */
export interface StockRow {
  sku_id: string;
  available_quantity: number | string;
  updated_at: string;
}

/** Insert payload for SKU persistence / constraint tests (not an HTTP API). */
export interface SkuInsertInput {
  sku_id?: string;
  product_id: string;
  sku_code: string;
  pack_quantity: number;
  pack_unit: string;
  price_minor: number;
  currency?: string;
  status?: string;
}

/** Insert payload for stock persistence / constraint tests (not an HTTP API). */
export interface StockInsertInput {
  sku_id: string;
  available_quantity: number;
}

/** Joined search row from Supabase (sku → product → category + stock). */
export interface CatalogSearchRow {
  sku_id: string;
  sku_code: string;
  pack_quantity: number | string;
  pack_unit: string;
  price_minor: number;
  currency: string;
  status: string;
  product: {
    product_id: string;
    name: string;
    brand: string | null;
    status: string;
    category: {
      code: string;
    } | null;
  } | null;
  stock:
    | { available_quantity: number | string }
    | { available_quantity: number | string }[]
    | null;
}
