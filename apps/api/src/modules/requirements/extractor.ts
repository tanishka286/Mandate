import type { ShoppingIntent } from "../intents/schema.js";
import type { ExtractionResult } from "./extraction-schema.js";

/**
 * Requirement extraction port (Phase 3 Step 5).
 * Interpretation only — never authorization, pricing, stock, or payment.
 * Phase 6 may supply an LLM-backed adapter behind the same interface.
 */
export interface RequirementExtractor {
  extract(intent: ShoppingIntent): Promise<ExtractionResult>;
}
