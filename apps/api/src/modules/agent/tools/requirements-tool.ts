import { z } from "zod";
import { parseOrThrow } from "../../../shared/validation/index.js";
import {
  extractionResultSchema,
  type ExtractionResult,
} from "../../requirements/extraction-schema.js";
import type { ShoppingIntent } from "../../intents/schema.js";
import type { AgentToolHandler } from "./registry.js";

/**
 * extract_requirements — adapter over RequirementExtractor port.
 *
 * Deterministic extractor remains authoritative for known patterns.
 * Optional LLM drafts (if supplied by a future extractor) MUST pass Zod.
 * Ambiguity → CLARIFICATION_REQUIRED; never invent hard constraints.
 */

const extractRequirementsArgsSchema = z
  .object({
    goal_text: z.string().min(1),
    quality_preference: z.string().min(1).nullable().optional(),
    budget_minor: z.number().int().nonnegative().nullable().optional(),
    category: z.string().min(1).optional(),
    /** Synthetic intent fields for the extractor port (not persisted here). */
    intent_id: z.string().uuid().optional(),
    session_id: z.string().uuid().optional(),
    mandate_id: z.string().uuid().optional(),
  })
  .strict();

function toSyntheticIntent(
  args: z.infer<typeof extractRequirementsArgsSchema>,
): ShoppingIntent {
  const now = new Date().toISOString();
  return {
    intent_id:
      args.intent_id ?? "00000000-0000-4000-8000-000000000001",
    session_id:
      args.session_id ?? "00000000-0000-4000-8000-000000000002",
    mandate_id:
      args.mandate_id ?? "00000000-0000-4000-8000-000000000003",
    goal_text: args.goal_text.trim(),
    category: args.category ?? "grocery",
    budget_minor: args.budget_minor ?? null,
    quality_preference: args.quality_preference ?? null,
    assumptions_json: [],
    status: "CREATED",
    created_at: now,
    updated_at: now,
  };
}

/**
 * Validate extractor output. Rejects malformed / invented authority fields.
 */
export function validateExtractionResult(raw: unknown): ExtractionResult {
  return parseOrThrow(extractionResultSchema, raw);
}

export const extractRequirementsTool: AgentToolHandler = async (
  args,
  context,
) => {
  try {
    const parsed = parseOrThrow(extractRequirementsArgsSchema, args);
    const intent = toSyntheticIntent(parsed);
    const result = context.extractor.extract(intent);
    const validated = validateExtractionResult(result);

    return {
      tool: "extract_requirements",
      status: "OK",
      data: validated,
    };
  } catch (error) {
    return {
      tool: "extract_requirements",
      status: "ERROR",
      error: {
        code: "REQUIREMENTS_EXTRACTION_FAILED",
        message:
          error instanceof Error ? error.message : "Requirements extraction failed",
      },
    };
  }
};
