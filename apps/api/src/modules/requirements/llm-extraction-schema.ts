import { z } from "zod";
import {
  clarificationSchema,
  extractedRequirementDraftSchema,
  extractionAssumptionSchema,
} from "./extraction-schema.js";

/**
 * Untrusted Qwen proposal for requirement extraction.
 * Backend validates and maps to ExtractionResult — never authoritative commerce data.
 */
export const llmRequirementProposalSchema = z
  .object({
    item_name: z.string().min(1),
    target_quantity: z.number().finite().positive(),
    unit: z.string().min(1),
    minimum_quality: z.string().min(1).nullable().optional(),
    confidence: z.number().finite().min(0).max(1).nullable().optional(),
  })
  .strict();

export type LlmRequirementProposal = z.infer<
  typeof llmRequirementProposalSchema
>;

export const llmExtractionPayloadSchema = z
  .object({
    status: z.enum(["SUCCESS", "CLARIFICATION_REQUIRED"]),
    requirements: z.array(llmRequirementProposalSchema).optional(),
    assumptions: z.array(extractionAssumptionSchema).optional(),
    clarification: clarificationSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "SUCCESS") {
      if (!value.requirements || value.requirements.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SUCCESS requires at least one requirement",
        });
      }
    }
    if (value.status === "CLARIFICATION_REQUIRED") {
      if (!value.clarification) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CLARIFICATION_REQUIRED requires clarification",
        });
      }
    }
  });

export type LlmExtractionPayload = z.infer<typeof llmExtractionPayloadSchema>;

/** Reject authority fields that must never come from the LLM. */
const FORBIDDEN_AUTHORITY_KEYS = [
  "price",
  "price_minor",
  "stock",
  "stock_available",
  "sku_id",
  "product_id",
  "authorize",
  "authorization",
  "payment",
  "payable",
  "mandate",
  "policy",
] as const;

export function assertNoForbiddenAuthorityFields(
  raw: unknown,
  path = "",
): void {
  if (raw === null || typeof raw !== "object") {
    return;
  }
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 1) {
      assertNoForbiddenAuthorityFields(raw[i], `${path}[${i}]`);
    }
    return;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      FORBIDDEN_AUTHORITY_KEYS.some(
        (forbidden) => lower === forbidden || lower.includes(forbidden),
      )
    ) {
      throw new Error(
        `LLM output attempted to set forbidden authority field: ${path ? `${path}.` : ""}${key}`,
      );
    }
    assertNoForbiddenAuthorityFields(value, path ? `${path}.${key}` : key);
  }
}

export function mapLlmPayloadToExtractionResult(
  payload: LlmExtractionPayload,
): z.infer<typeof import("./extraction-schema.js").extractionResultSchema> {
  if (payload.status === "CLARIFICATION_REQUIRED") {
    return {
      status: "CLARIFICATION_REQUIRED",
      requirements: [],
      assumptions: payload.assumptions ?? [],
      clarification: payload.clarification!,
    };
  }

  const requirements = payload.requirements!.map((req) =>
    extractedRequirementDraftSchema.parse({
      item_name: req.item_name.trim(),
      target_quantity: req.target_quantity,
      unit: req.unit.trim(),
      minimum_quality: req.minimum_quality ?? null,
      constraints_json: [],
      confidence: req.confidence ?? null,
    }),
  );

  return {
    status: "SUCCESS",
    requirements,
    assumptions: payload.assumptions ?? [],
  };
}
