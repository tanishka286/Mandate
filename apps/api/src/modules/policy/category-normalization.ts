/**
 * Doc 07 / Doc 10 — Catalog category codes vs mandate allow-list labels.
 *
 * Mandates store policy labels (e.g. "grocery"). Catalog products use granular
 * category codes (dairy, pantry, produce, beverages). Normalization is
 * deterministic and does not broaden mandate authorization beyond grocery demo.
 */

/** Catalog codes that map to the mandate policy label `grocery`. */
export const GROCERY_CATALOG_CATEGORY_CODES = [
  "dairy",
  "pantry",
  "produce",
  "beverages",
] as const;

export type GroceryCatalogCategoryCode =
  (typeof GROCERY_CATALOG_CATEGORY_CODES)[number];

const GROCERY_CATALOG_SET = new Set<string>(GROCERY_CATALOG_CATEGORY_CODES);

/**
 * Map a catalog `category.code` to the policy category label used in mandates.
 * Unmapped codes pass through unchanged (e.g. household).
 */
export function normalizeCatalogCategoryForPolicy(
  catalogCategoryCode: string,
): string {
  if (GROCERY_CATALOG_SET.has(catalogCategoryCode)) {
    return "grocery";
  }
  return catalogCategoryCode;
}

/**
 * Whether a catalog SKU category is authorized by the mandate allow-list.
 * Supports both normalized policy labels and explicit catalog code entries.
 */
export function isCatalogCategoryAllowedForMandate(
  catalogCategoryCode: string,
  allowedMandateCategories: readonly string[],
): boolean {
  const allowed = new Set(allowedMandateCategories);
  const policyCategory = normalizeCatalogCategoryForPolicy(catalogCategoryCode);
  if (allowed.has(policyCategory)) {
    return true;
  }
  return allowed.has(catalogCategoryCode);
}
