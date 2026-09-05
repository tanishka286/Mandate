import { z } from "zod";
import { parseOrThrow } from "../../../shared/validation/index.js";
import type { AgentToolHandler } from "./registry.js";

/**
 * search_catalog / get_product — adapters over CatalogService.
 *
 * Prices and stock in tool output are authoritative backend facts.
 * LLM must not query the database or invent catalog parameters.
 */

const searchCatalogArgsSchema = z
  .object({
    q: z.string().min(1),
    category: z.string().min(1).optional(),
    limit: z.number().int().positive().max(50).optional(),
  })
  .strict();

const getProductArgsSchema = z
  .object({
    product_id: z.string().uuid(),
  })
  .strict();

export const searchCatalogTool: AgentToolHandler = async (args, context) => {
  try {
    const query = parseOrThrow(searchCatalogArgsSchema, args);
    const result = await context.catalog.searchCatalog(query);
    return {
      tool: "search_catalog",
      status: "OK",
      data: result,
    };
  } catch (error) {
    return {
      tool: "search_catalog",
      status: "ERROR",
      error: {
        code: "CATALOG_SEARCH_FAILED",
        message:
          error instanceof Error ? error.message : "Catalog search failed",
      },
    };
  }
};

export const getProductTool: AgentToolHandler = async (args, context) => {
  try {
    const { product_id } = parseOrThrow(getProductArgsSchema, args);
    const product = await context.catalog.getProductById(product_id);

    // Product description is untrusted free text if present — keep as data.
    const description =
      "description" in product && typeof (product as { description?: unknown }).description === "string"
        ? {
            kind: "untrusted_data" as const,
            text: (product as { description: string }).description,
          }
        : undefined;

    return {
      tool: "get_product",
      status: "OK",
      data: {
        ...product,
        ...(description ? { description_untrusted: description } : {}),
      },
    };
  } catch (error) {
    return {
      tool: "get_product",
      status: "ERROR",
      error: {
        code: "GET_PRODUCT_FAILED",
        message:
          error instanceof Error ? error.message : "Get product failed",
      },
    };
  }
};
