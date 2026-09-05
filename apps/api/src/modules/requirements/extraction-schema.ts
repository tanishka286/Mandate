import { z } from "zod";
import {
  confidenceSchema,
  constraintsJsonSchema,
  intentIdSchema,
  itemNameSchema,
  minimumQualitySchema,
  requirementIdSchema,
  requirementUnitSchema,
  targetQuantitySchema,
} from "./schema.js";

/**
 * Extraction outcome statuses (Phase 3 Step 5).
 * Clarification is an API/service result — not a requirement or intent DB status.
 */
export const EXTRACTION_STATUSES = [
  "SUCCESS",
  "CLARIFICATION_REQUIRED",
] as const;

export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const extractionStatusSchema = z.enum(EXTRACTION_STATUSES);

export const extractionAssumptionSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    /** Optional structured detail (e.g. "0.5 pack per serving"). */
    detail: z.string().min(1).optional(),
    /** Optional rule provenance (never authorization authority). */
    source: z.string().min(1).optional(),
  })
  .strict();

export type ExtractionAssumption = z.infer<typeof extractionAssumptionSchema>;

export const clarificationSchema = z
  .object({
    question: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

export type Clarification = z.infer<typeof clarificationSchema>;

/**
 * Draft requirement produced by an extractor before persistence.
 * No product/SKU/price/stock/payment fields.
 */
export const extractedRequirementDraftSchema = z
  .object({
    item_name: itemNameSchema,
    target_quantity: targetQuantitySchema,
    unit: requirementUnitSchema,
    minimum_quality: minimumQualitySchema,
    constraints_json: constraintsJsonSchema,
    confidence: confidenceSchema,
  })
  .strict();

export type ExtractedRequirementDraft = z.infer<
  typeof extractedRequirementDraftSchema
>;

export const extractionSuccessResultSchema = z
  .object({
    status: z.literal("SUCCESS"),
    requirements: z.array(extractedRequirementDraftSchema).min(1),
    assumptions: z.array(extractionAssumptionSchema),
  })
  .strict();

export const extractionClarificationResultSchema = z
  .object({
    status: z.literal("CLARIFICATION_REQUIRED"),
    requirements: z.array(extractedRequirementDraftSchema),
    assumptions: z.array(extractionAssumptionSchema),
    clarification: clarificationSchema,
  })
  .strict();

export const extractionResultSchema = z.discriminatedUnion("status", [
  extractionSuccessResultSchema,
  extractionClarificationResultSchema,
]);

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** Doc 08 extract response requirement (persisted ids, no constraints_json in envelope). */
export const requirementExtractionItemSchema = z
  .object({
    requirement_id: requirementIdSchema,
    item_name: itemNameSchema,
    target_quantity: targetQuantitySchema,
    unit: requirementUnitSchema,
    minimum_quality: minimumQualitySchema,
    confidence: confidenceSchema,
  })
  .strict();

export type RequirementExtractionItem = z.infer<
  typeof requirementExtractionItemSchema
>;

export const requirementExtractionSuccessDataSchema = z
  .object({
    status: z.literal("SUCCESS"),
    intent_id: intentIdSchema,
    requirements: z.array(requirementExtractionItemSchema),
    assumptions: z.array(extractionAssumptionSchema),
  })
  .strict();

export const requirementExtractionClarificationDataSchema = z
  .object({
    status: z.literal("CLARIFICATION_REQUIRED"),
    intent_id: intentIdSchema,
    requirements: z.array(requirementExtractionItemSchema),
    assumptions: z.array(extractionAssumptionSchema),
    clarification: clarificationSchema,
  })
  .strict();

export const requirementExtractionResponseDataSchema = z.discriminatedUnion(
  "status",
  [
    requirementExtractionSuccessDataSchema,
    requirementExtractionClarificationDataSchema,
  ],
);

export type RequirementExtractionResponseData = z.infer<
  typeof requirementExtractionResponseDataSchema
>;

export const intentIdParamsSchema = z.object({
  intent_id: intentIdSchema,
});

export type IntentIdParams = z.infer<typeof intentIdParamsSchema>;
