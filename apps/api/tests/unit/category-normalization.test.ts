import { describe, it, expect } from "vitest";
import {
  GROCERY_CATALOG_CATEGORY_CODES,
  isCatalogCategoryAllowedForMandate,
  normalizeCatalogCategoryForPolicy,
} from "../../src/modules/policy/category-normalization.js";

describe("Phase 10 — catalog category normalization", () => {
  it("maps grocery demo catalog codes to policy label grocery", () => {
    for (const code of GROCERY_CATALOG_CATEGORY_CODES) {
      expect(normalizeCatalogCategoryForPolicy(code)).toBe("grocery");
    }
  });

  it("passes through unmapped catalog codes unchanged", () => {
    expect(normalizeCatalogCategoryForPolicy("household")).toBe("household");
  });

  it("allows dairy under grocery-only mandate", () => {
    expect(isCatalogCategoryAllowedForMandate("dairy", ["grocery"])).toBe(true);
  });

  it("denies household under grocery-only mandate", () => {
    expect(isCatalogCategoryAllowedForMandate("household", ["grocery"])).toBe(
      false,
    );
  });

  it("allows explicit catalog code when mandate lists it directly", () => {
    expect(isCatalogCategoryAllowedForMandate("dairy", ["dairy"])).toBe(true);
  });
});
