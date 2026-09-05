import { describe, it, expect } from "vitest";
import { CatalogService } from "../../src/modules/catalog/service.js";
import type { CatalogRepository } from "../../src/modules/catalog/repository.js";
import type { CategoryRow } from "../../src/modules/catalog/types.js";
import { MVP_CATEGORY_CODES } from "../../src/modules/catalog/schema.js";

function row(
  code: string,
  name: string,
  idSuffix: string,
): CategoryRow {
  return {
    category_id: `11111111-1111-4111-8111-1111111111${idSuffix}`,
    code,
    name,
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  };
}

describe("CatalogService.listCategories", () => {
  it("returns categories in deterministic code order", async () => {
    const repository = {
      listCategories: async () => [
        row("produce", "Produce", "03"),
        row("dairy", "Dairy", "01"),
        row("household", "Household", "05"),
        row("beverages", "Beverages", "04"),
        row("pantry", "Pantry", "02"),
      ],
    } as CatalogRepository;

    const service = new CatalogService(repository);
    const result = await service.listCategories();

    expect(result.categories.map((c) => c.code)).toEqual([
      "beverages",
      "dairy",
      "household",
      "pantry",
      "produce",
    ]);
  });

  it("returns the full MVP category set when repository provides it", async () => {
    const repository = {
      listCategories: async () =>
        MVP_CATEGORY_CODES.map((code, index) =>
          row(code, code[0]!.toUpperCase() + code.slice(1), String(index + 1).padStart(2, "0")),
        ),
    } as CatalogRepository;

    const service = new CatalogService(repository);
    const result = await service.listCategories();

    expect(result.categories).toHaveLength(5);
    expect(result.categories.map((c) => c.code).sort()).toEqual(
      [...MVP_CATEGORY_CODES].sort(),
    );
  });

  it("rejects rows with unknown category codes", async () => {
    const repository = {
      listCategories: async () => [row("electronics", "Electronics", "99")],
    } as CatalogRepository;

    const service = new CatalogService(repository);
    await expect(service.listCategories()).rejects.toThrow(/Validation failed/);
  });
});
