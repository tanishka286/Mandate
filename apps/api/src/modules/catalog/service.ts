import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { CatalogRepository } from "./repository.js";
import {
  catalogSearchQuerySchema,
  catalogSearchResultSchema,
  categoryListSchema,
  categorySchema,
  CATALOG_SEARCH_DEFAULT_LIMIT,
  productDetailSchema,
  productParamsSchema,
  skuSchema,
  stockAvailabilitySchema,
  type CatalogSearchItem,
  type CatalogSearchResult,
  type Category,
  type ProductDetail,
  type Sku,
  type SkuWithStock,
  type StockAvailability,
} from "./schema.js";
import type {
  CatalogSearchRow,
  CategoryListData,
  CategoryRow,
  ProductWithCategoryRow,
  SkuRow,
  StockRow,
} from "./types.js";

/**
 * Catalog service — Category + Product + SKU + Stock + Search (Phase 1 Steps 1–5).
 * Controllers call services; services call repositories. No DB logic here.
 */
export class CatalogService {
  constructor(private readonly repository = new CatalogRepository()) {}

  async listCategories(): Promise<CategoryListData> {
    const rows = await this.repository.listCategories();
    const categories = rows
      .map((row) => this.toCategory(row))
      .sort((a, b) => a.code.localeCompare(b.code));

    return parseOrThrow(categoryListSchema, { categories });
  }

  async searchCatalog(rawQuery: unknown): Promise<CatalogSearchResult> {
    const query = parseOrThrow(catalogSearchQuerySchema, rawQuery);
    const limit =
      typeof query.limit === "number"
        ? query.limit
        : CATALOG_SEARCH_DEFAULT_LIMIT;

    const rows = await this.repository.searchCatalog({
      q: query.q,
      categoryCode: query.category,
      limit,
    });

    const items = rows
      .map((row) => this.toSearchItem(row))
      .sort((a, b) => a.sku_code.localeCompare(b.sku_code));

    return parseOrThrow(catalogSearchResultSchema, { items });
  }

  async getProductById(productId: string): Promise<ProductDetail> {
    parseOrThrow(productParamsSchema, { product_id: productId });

    const row = await this.repository.getProductWithCategory(productId);
    if (!row) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Product not found",
        statusCode: 404,
        details: { product_id: productId },
      });
    }

    const skuRows =
      await this.repository.listActiveSkusByProductId(productId);
    const stockRows = await this.repository.listStockBySkuIds(
      skuRows.map((sku) => sku.sku_id),
    );

    return this.toProductDetail(row, skuRows, stockRows);
  }

  private toCategory(row: CategoryRow): Category {
    return parseOrThrow(categorySchema, {
      category_id: row.category_id,
      code: row.code,
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  private toSku(row: SkuRow): Sku {
    const packQuantity =
      typeof row.pack_quantity === "string"
        ? Number(row.pack_quantity)
        : row.pack_quantity;

    return parseOrThrow(skuSchema, {
      sku_id: row.sku_id,
      product_id: row.product_id,
      sku_code: row.sku_code,
      pack_quantity: packQuantity,
      pack_unit: row.pack_unit,
      price_minor: row.price_minor,
      currency: row.currency,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  private toStockAvailability(row: StockRow): StockAvailability {
    const availableQuantity =
      typeof row.available_quantity === "string"
        ? Number(row.available_quantity)
        : row.available_quantity;

    return parseOrThrow(stockAvailabilitySchema, {
      available_quantity: availableQuantity,
    });
  }

  private toSkuWithStock(
    row: SkuRow,
    stockBySkuId: Map<string, StockRow>,
  ): SkuWithStock {
    const sku = this.toSku(row);
    const stockRow = stockBySkuId.get(row.sku_id);
    return {
      ...sku,
      stock: stockRow ? this.toStockAvailability(stockRow) : null,
    };
  }

  private toSearchItem(row: CatalogSearchRow): CatalogSearchItem {
    if (!row.product) {
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "Search row is missing product relationship",
        statusCode: 500,
        expose: false,
      });
    }

    const packQuantity =
      typeof row.pack_quantity === "string"
        ? Number(row.pack_quantity)
        : row.pack_quantity;

    const stockNode = Array.isArray(row.stock) ? row.stock[0] : row.stock;
    const stockAvailable =
      stockNode === null || stockNode === undefined
        ? null
        : typeof stockNode.available_quantity === "string"
          ? Number(stockNode.available_quantity)
          : stockNode.available_quantity;

    return {
      product_id: row.product.product_id,
      sku_id: row.sku_id,
      name: row.product.name,
      sku_code: row.sku_code,
      pack_quantity: packQuantity,
      pack_unit: row.pack_unit,
      price_minor: row.price_minor,
      currency: row.currency as "INR",
      stock_available: stockAvailable,
    };
  }

  private toProductDetail(
    row: ProductWithCategoryRow,
    skuRows: SkuRow[],
    stockRows: StockRow[],
  ): ProductDetail {
    if (!row.category) {
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "Product is missing category relationship",
        statusCode: 500,
        expose: false,
      });
    }

    const stockBySkuId = new Map(
      stockRows.map((stockRow) => [stockRow.sku_id, stockRow]),
    );

    const skus = skuRows
      .map((skuRow) => this.toSkuWithStock(skuRow, stockBySkuId))
      .sort((a, b) => a.sku_code.localeCompare(b.sku_code));

    return parseOrThrow(productDetailSchema, {
      product_id: row.product_id,
      name: row.name,
      description: row.description,
      category_id: row.category_id,
      brand: row.brand,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      category: this.toCategory(row.category),
      skus,
    });
  }
}
