import type { StructuredLlmProvider } from "../agent/ai-adapter.js";
import type { ShoppingIntent } from "../intents/schema.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import type { RequirementExtractor } from "./extractor.js";
import {
  extractionResultSchema,
  type ExtractionResult,
} from "./extraction-schema.js";
import {
  assertNoForbiddenAuthorityFields,
  llmExtractionPayloadSchema,
  mapLlmPayloadToExtractionResult,
} from "./llm-extraction-schema.js";

const REQUIREMENT_EXTRACTION_SYSTEM = [
  "Convert grocery goals to minimal JSON requirements.",
  "Use direct grocery item names from the request: rice, paneer, chapati, salad; map egg curry to eggs.",
  "Do not substitute different ingredients (no flour for chapati, no generic vegetables for salad).",
  "Party size + named items → SUCCESS with practical quantities; never ask for brands/recipes.",
  "Only CLARIFICATION_REQUIRED when no items are named (e.g. 'some eggs', 'something healthy').",
  "Never include price, stock, sku_id, product_id, payment, or policy fields.",
  "On SUCCESS: return only status, requirements, assumptions (max 2 short entries). Omit clarification.",
  "On CLARIFICATION_REQUIRED: return status, empty requirements, clarification, assumptions.",
  'Schema: {"status":"SUCCESS"|"CLARIFICATION_REQUIRED","requirements":[{"item_name":string,"target_quantity":number,"unit":string}],"clarification?":{"question":string,"reason":string},"assumptions":[{"code":string,"message":string}]}',
].join(" ");

function buildExtractionUserPrompt(intent: ShoppingIntent): string {
  return intent.goal_text.trim();
}

/**
 * Qwen-backed requirement extractor (Phase 10 AI planning).
 * Proposes structured requirements; backend Zod validation is authoritative.
 */
export class LlmRequirementExtractor implements RequirementExtractor {
  constructor(private readonly llm: StructuredLlmProvider) {}

  async extract(intent: ShoppingIntent): Promise<ExtractionResult> {
    try {
      const payload = await this.llm.generateStructured({
        system: REQUIREMENT_EXTRACTION_SYSTEM,
        user: buildExtractionUserPrompt(intent),
        schema: llmExtractionPayloadSchema,
        fastStructured: true,
      });

      assertNoForbiddenAuthorityFields(payload);

      const mapped = mapLlmPayloadToExtractionResult(payload);
      return parseOrThrow(extractionResultSchema, mapped);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "LLM requirement extraction failed";
      return {
        status: "CLARIFICATION_REQUIRED",
        requirements: [],
        assumptions: [
          {
            code: "LLM_EXTRACTION_UNAVAILABLE",
            message:
              "Could not safely extract requirements from the goal at this time.",
            source: "LlmRequirementExtractor",
          },
        ],
        clarification: {
          question:
            "Please list each grocery item with an explicit quantity (e.g. 6 eggs, 2 packs pasta).",
          reason: message,
        },
      };
    }
  }
}
