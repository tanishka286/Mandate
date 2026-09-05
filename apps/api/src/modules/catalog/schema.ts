import { z } from "zod";

/** Controlled MVP category codes (Phase 1 Step 1). */
export const MVP_CATEGORY_CODES = [
  "dairy",
  "pantry",
  "produce",
  "beverages",
  "household",
] as const;

export type CategoryCode = (typeof MVP_CATEGORY_CODES)[number];

export const categoryCodeSchema = z.enum(MVP_CATEGORY_CODES);

/** Accepts UTC ISO timestamps from Postgres/Supabase (including fractional seconds). */
const isoUtcTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

export const categorySchema = z.object({
  category_id: z.string().uuid(),
  code: categoryCodeSchema,
  name: z.string().min(1),
  created_at: isoUtcTimestampSchema,
  updated_at: isoUtcTimestampSchema,
});

export type Category = z.infer<typeof categorySchema>;

export const categoryListSchema = z.object({
  categories: z.array(categorySchema),
});

export type CategoryList = z.infer<typeof categoryListSchema>;

/** Validates that a set of codes contains no duplicates. */
export function assertUniqueCategoryCodes(codes: readonly string[]): void {
  const seen = new Set<string>();
  for (const code of codes) {
    if (seen.has(code)) {
      const error = new Error("Duplicate category code") as Error & {
        code: string;
        statusCode: number;
        details: Record<string, unknown>;
      };
      error.code = "CONFLICT";
      error.statusCode = 409;
      error.details = { code };
      throw error;
    }
    seen.add(code);
  }
}

/** Controlled product lifecycle statuses (Phase 1 Step 2). */
export const PRODUCT_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const productStatusSchema = z.enum(PRODUCT_STATUSES);

export const productIdSchema = z.string().uuid();

export const productSchema = z.object({
  product_id: productIdSchema,
  name: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, {
      message: "Product name must not be empty",
    }),
  description: z.string(),
  category_id: z.string().uuid(),
  brand: z.string().min(1).nullable(),
  status: productStatusSchema,
  created_at: isoUtcTimestampSchema,
  updated_at: isoUtcTimestampSchema,
});

export type Product = z.infer<typeof productSchema>;

export const productParamsSchema = z.object({
  product_id: productIdSchema,
});

/** Controlled SKU lifecycle statuses (Phase 1 Step 3). Distinct from Stock. */
export const SKU_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export type SkuStatus = (typeof SKU_STATUSES)[number];

export const skuStatusSchema = z.enum(SKU_STATUSES);

export const skuIdSchema = z.string().uuid();

export const MVP_CURRENCY = "INR" as const;

export const currencySchema = z.literal(MVP_CURRENCY);

/** Authoritative INR price in integer paise (no floats). */
export const priceMinorSchema = z
  .number()
  .int("price_minor must be an integer")
  .nonnegative("price_minor must be >= 0");

/** Pack quantity as positive number (DECIMAL-compatible; not integer-only). */
export const packQuantitySchema = z
  .number()
  .finite()
  .positive("pack_quantity must be positive");

export const skuSchema = z.object({
  sku_id: skuIdSchema,
  product_id: productIdSchema,
  sku_code: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, {
      message: "sku_code must not be empty",
    }),
  pack_quantity: packQuantitySchema,
  pack_unit: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, {
      message: "pack_unit must not be empty",
    }),
  price_minor: priceMinorSchema,
  currency: currencySchema,
  status: skuStatusSchema,
  created_at: isoUtcTimestampSchema,
  updated_at: isoUtcTimestampSchema,
});

export type Sku = z.infer<typeof skuSchema>;

/** Stock quantity (NUMERIC/DECIMAL-compatible; not money). */
export const availableQuantitySchema = z
  .number()
  .finite()
  .nonnegative("available_quantity must be >= 0");

export const stockSchema = z.object({
  sku_id: skuIdSchema,
  available_quantity: availableQuantitySchema,
  updated_at: isoUtcTimestampSchema,
});

export type Stock = z.infer<typeof stockSchema>;

/** Nested stock state exposed on product SKUs (from stock table only). */
export const stockAvailabilitySchema = z.object({
  available_quantity: availableQuantitySchema,
});

export type StockAvailability = z.infer<typeof stockAvailabilitySchema>;

/** SKU with optional authoritative stock; null means no stock row (never invent). */
export const skuWithStockSchema = skuSchema.extend({
  stock: stockAvailabilitySchema.nullable(),
});

export type SkuWithStock = z.infer<typeof skuWithStockSchema>;

/** Product detail with related category and ACTIVE SKUs + stock (no evidence). */
export const productDetailSchema = productSchema.extend({
  category: categorySchema,
  skus: z.array(skuWithStockSchema),
});

export type ProductDetail = z.infer<typeof productDetailSchema>;

/** Validates that a set of sku_codes contains no duplicates. */
export function assertUniqueSkuCodes(codes: readonly string[]): void {
  const seen = new Set<string>();
  for (const code of codes) {
    if (seen.has(code)) {
      const error = new Error("Duplicate sku_code") as Error & {
        code: string;
        statusCode: number;
        details: Record<string, unknown>;
      };
      error.code = "CONFLICT";
      error.statusCode = 409;
      error.details = { sku_code: code };
      throw error;
    }
    seen.add(code);
  }
}

/** Catalog search defaults (Phase 1 Step 5). */
export const CATALOG_SEARCH_DEFAULT_LIMIT = 20;
export const CATALOG_SEARCH_MAX_LIMIT = 50;

/**
 * Query params for GET /catalog/search.
 * Empty/whitespace q becomes undefined (no text filter).
 * Unknown category codes are allowed and yield empty results at query time.
 */
export const catalogSearchQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }),
  category: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") {
        return CATALOG_SEARCH_DEFAULT_LIMIT;
      }
      const parsed = typeof value === "number" ? value : Number(value);
      return parsed;
    })
    .pipe(
      z
        .number({
          invalid_type_error: "limit must be an integer",
        })
        .int("limit must be an integer")
        .min(1, "limit must be >= 1")
        .max(
          CATALOG_SEARCH_MAX_LIMIT,
          `limit must be <= ${CATALOG_SEARCH_MAX_LIMIT}`,
        ),
    ),
});

export type CatalogSearchQuery = z.infer<typeof catalogSearchQuerySchema>;

/** One searchable catalog row (Product × ACTIVE SKU × Stock). */
export const catalogSearchItemSchema = z.object({
  product_id: productIdSchema,
  sku_id: skuIdSchema,
  name: z.string().min(1),
  sku_code: z.string().min(1),
  pack_quantity: packQuantitySchema,
  pack_unit: z.string().min(1),
  price_minor: priceMinorSchema,
  currency: currencySchema,
  category_code: z.string().min(1),
  product_status: productStatusSchema,
  sku_status: skuStatusSchema,
  brand: z.string().min(1).nullable(),
  /** null when no stock row exists; 0 means out of stock. Never invent. */
  stock_available: availableQuantitySchema.nullable(),
});

export type CatalogSearchItem = z.infer<typeof catalogSearchItemSchema>;

export const catalogSearchResultSchema = z.object({
  items: z.array(catalogSearchItemSchema),
});

export type CatalogSearchResult = z.infer<typeof catalogSearchResultSchema>;

