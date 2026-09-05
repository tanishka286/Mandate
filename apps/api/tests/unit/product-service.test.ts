import { describe, it, expect } from "vitest";
import { CatalogService } from "../../src/modules/catalog/service.js";
import type { CatalogRepository } from "../../src/modules/catalog/repository.js";
import type {
  ProductWithCategoryRow,
  SkuRow,
  StockRow,
} from "../../src/modules/catalog/types.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { mapDatabaseError } from "../../src/shared/errors/database.js";

const dairyCategory = {
  category_id: "11111111-1111-4111-8111-111111111101",
  code: "dairy",
  name: "Dairy",
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
};

const eggsProduct: ProductWithCategoryRow = {
  product_id: "22222222-2222-4222-8222-222222222201",
  name: "Farm Eggs",
  description: "Fresh farm eggs suitable for everyday cooking.",
  category_id: dairyCategory.category_id,
  brand: "FarmFresh",
  status: "ACTIVE",
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T12:00:00.000Z",
  category: dairyCategory,
};

const eggSkus: SkuRow[] = [
  {
    sku_id: "33333333-3333-4333-8333-333333333302",
    product_id: eggsProduct.product_id,
    sku_code: "FARM-EGGS-6",
    pack_quantity: 6,
    pack_unit: "pieces",
    price_minor: 3600,
    currency: "INR",
    status: "ACTIVE",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  },
  {
    sku_id: "33333333-3333-4333-8333-333333333301",
    product_id: eggsProduct.product_id,
    sku_code: "FARM-EGGS-2",
    pack_quantity: 2,
    pack_unit: "pieces",
    price_minor: 1200,
    currency: "INR",
    status: "ACTIVE",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  },
];

const eggStock: StockRow[] = [
  {
    sku_id: "33333333-3333-4333-8333-333333333301",
    available_quantity: 48,
    updated_at: "2026-09-04T12:00:00.000Z",
  },
  {
    sku_id: "33333333-3333-4333-8333-333333333302",
    available_quantity: 24,
    updated_at: "2026-09-04T12:00:00.000Z",
  },
];

describe("CatalogService.getProductById", () => {
  it("returns product with category, SKUs, and stock ordered by sku_code", async () => {
    const repository = {
      listCategories: async () => [],
      getProductWithCategory: async (id: string) =>
        id === eggsProduct.product_id ? eggsProduct : null,
      listActiveSkusByProductId: async () => eggSkus,
      listStockBySkuIds: async () => eggStock,
    } as CatalogRepository;

    const service = new CatalogService(repository);
    const product = await service.getProductById(eggsProduct.product_id);

    expect(product.skus.map((s) => s.sku_code)).toEqual([
      "FARM-EGGS-2",
      "FARM-EGGS-6",
    ]);
    expect(product.skus[0]?.stock).toEqual({ available_quantity: 48 });
    expect(product.skus[1]?.stock).toEqual({ available_quantity: 24 });
  });

  it("does not fabricate stock when a stock row is missing", async () => {
    const repository = {
      listCategories: async () => [],
      getProductWithCategory: async () => eggsProduct,
      listActiveSkusByProductId: async () => eggSkus,
      listStockBySkuIds: async () => [eggStock[0]!],
    } as CatalogRepository;

    const service = new CatalogService(repository);
    const product = await service.getProductById(eggsProduct.product_id);

    expect(product.skus[0]?.stock).toEqual({ available_quantity: 48 });
    expect(product.skus[1]?.stock).toBeNull();
  });

  it("returns zero stock without treating SKU as inactive", async () => {
    const repository = {
      listCategories: async () => [],
      getProductWithCategory: async () => eggsProduct,
      listActiveSkusByProductId: async () => [eggSkus[0]!],
      listStockBySkuIds: async () => [
        {
          sku_id: eggSkus[0]!.sku_id,
          available_quantity: 0,
          updated_at: "2026-09-04T12:00:00.000Z",
        },
      ],
    } as CatalogRepository;

    const service = new CatalogService(repository);
    const product = await service.getProductById(eggsProduct.product_id);

    expect(product.skus[0]?.status).toBe("ACTIVE");
    expect(product.skus[0]?.stock).toEqual({ available_quantity: 0 });
  });

  it("throws NOT_FOUND for missing product", async () => {
    const repository = {
      listCategories: async () => [],
      getProductWithCategory: async () => null,
      listActiveSkusByProductId: async () => [],
      listStockBySkuIds: async () => [],
    } as CatalogRepository;

    const service = new CatalogService(repository);
    await expect(
      service.getProductById("22222222-2222-4222-8222-222222222299"),
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      statusCode: 404,
    });
  });

  it("rejects invalid product UUID before repository access", async () => {
    const repository = {
      listCategories: async () => [],
      getProductWithCategory: async () => {
        throw new Error("repository should not be called");
      },
      listActiveSkusByProductId: async () => {
        throw new Error("repository should not be called");
      },
      listStockBySkuIds: async () => {
        throw new Error("repository should not be called");
      },
    } as CatalogRepository;

    const service = new CatalogService(repository);
    await expect(service.getProductById("not-a-uuid")).rejects.toThrow(
      /Validation failed/,
    );
  });

  it("maps duplicate stock row to CONFLICT", () => {
    const err = mapDatabaseError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "stock_pkey"',
    });
    expect(err.code).toBe(ErrorCodes.CONFLICT);
    expect(err.statusCode).toBe(409);
  });

  it("maps invalid sku FK to VALIDATION_ERROR", () => {
    const err = mapDatabaseError({
      code: "23503",
      message:
        'insert or update on table "stock" violates foreign key constraint',
    });
    expect(err.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(err.statusCode).toBe(400);
  });

  it("does not treat AppError internals as success", async () => {
    const repository = {
      listCategories: async () => [],
      getProductWithCategory: async () => {
        throw new AppError({
          code: ErrorCodes.INTERNAL_ERROR,
          message: "db boom",
          statusCode: 500,
          expose: false,
        });
      },
      listActiveSkusByProductId: async () => [],
      listStockBySkuIds: async () => [],
    } as CatalogRepository;

    const service = new CatalogService(repository);
    await expect(
      service.getProductById(eggsProduct.product_id),
    ).rejects.toBeInstanceOf(AppError);
  });
});
