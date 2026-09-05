import { describe, it, expect } from "vitest";
import {
  MVP_CATEGORY_CODES,
  assertUniqueCategoryCodes,
  categoryCodeSchema,
  categoryListSchema,
  categorySchema,
} from "../../src/modules/catalog/schema.js";

describe("category schema validation", () => {
  it("accepts all MVP category codes", () => {
    for (const code of MVP_CATEGORY_CODES) {
      expect(categoryCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects unknown category codes", () => {
    expect(() => categoryCodeSchema.parse("electronics")).toThrow();
  });

  it("accepts a valid category record", () => {
    const category = categorySchema.parse({
      category_id: "11111111-1111-4111-8111-111111111101",
      code: "dairy",
      name: "Dairy",
      created_at: "2026-09-04T12:00:00.000Z",
      updated_at: "2026-09-04T12:00:00.000Z",
    });
    expect(category.code).toBe("dairy");
  });

  it("rejects invalid category_id", () => {
    expect(() =>
      categorySchema.parse({
        category_id: "not-a-uuid",
        code: "dairy",
        name: "Dairy",
        created_at: "2026-09-04T12:00:00.000Z",
        updated_at: "2026-09-04T12:00:00.000Z",
      }),
    ).toThrow();
  });

  it("accepts a category list payload", () => {
    const parsed = categoryListSchema.parse({
      categories: [
        {
          category_id: "11111111-1111-4111-8111-111111111101",
          code: "dairy",
          name: "Dairy",
          created_at: "2026-09-04T12:00:00.000Z",
          updated_at: "2026-09-04T12:00:00.000Z",
        },
      ],
    });
    expect(parsed.categories).toHaveLength(1);
  });

  it("MVP codes are unique", () => {
    expect(() => assertUniqueCategoryCodes(MVP_CATEGORY_CODES)).not.toThrow();
  });

  it("detects duplicate category codes", () => {
    expect(() =>
      assertUniqueCategoryCodes(["dairy", "pantry", "dairy"]),
    ).toThrow(/Duplicate category code/);
  });
});
