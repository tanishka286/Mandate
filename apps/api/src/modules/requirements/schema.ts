import { z } from "zod";

/**
 * Requirement lifecycle statuses (Doc 07 §9.2).
 * Locked docs require a status ENUM but do not enumerate multi-step requirement
 * states (Doc 08 extract response has no requirement.status field).
 * CREATED = persisted need for an intent. No catalog/optimization states invented.
 * Persistence only in Phase 3 Step 3 — extraction service deferred.
 */
export const REQUIREMENT_STATUSES = ["CREATED"] as const;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const requirementStatusSchema = z.enum(REQUIREMENT_STATUSES);

/** Accepts UTC ISO timestamps from Postgres/Supabase (including fractional seconds). */
const isoUtcTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

export const requirementIdSchema = z.string().uuid();

export const intentIdSchema = z.string().uuid();

/** Grocery item/ingredient needed — not a product_id or sku_id. */
export const itemNameSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "item_name must not be empty",
  });

/**
 * Required quantity before pack/SKU selection (DECIMAL/NUMERIC-compatible).
 * Must be positive; integers and decimals both allowed.
 */
export const targetQuantitySchema = z
  .number({
    invalid_type_error: "target_quantity must be a number",
  })
  .finite("target_quantity must be finite")
  .positive("target_quantity must be positive");

/** Unit for target_quantity (e.g. pieces, packs). Nonempty; no conversion here. */
export const requirementUnitSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "unit must not be empty",
  });

/** Optional minimum quality label; null when not material. */
export const minimumQualitySchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "minimum_quality must not be empty when provided",
  })
  .nullable();

/**
 * Structured constraints for the requirement (default empty array).
 * Not catalog, price, stock, or policy authority.
 */
export const constraintsJsonSchema = z.array(z.unknown());

/**
 * Optional extraction confidence in [0, 1] (Doc 08 example: 0.94).
 * Interpretation metadata — not authorization.
 */
export const confidenceSchema = z
  .number({
    invalid_type_error: "confidence must be a number",
  })
  .finite("confidence must be finite")
  .min(0, "confidence must be >= 0")
  .max(1, "confidence must be <= 1")
  .nullable();

/**
 * Persisted requirement row shape (Doc 07 §9.2).
 * Represents what the user needs — not product/SKU/price/stock/basket/payment.
 */
export const requirementSchema = z
  .object({
    requirement_id: requirementIdSchema,
    intent_id: intentIdSchema,
    item_name: itemNameSchema,
    target_quantity: targetQuantitySchema,
    unit: requirementUnitSchema,
    minimum_quality: minimumQualitySchema,
    constraints_json: constraintsJsonSchema,
    confidence: confidenceSchema,
    status: requirementStatusSchema,
    created_at: isoUtcTimestampSchema,
    updated_at: isoUtcTimestampSchema,
  })
  .strict();

export type Requirement = z.infer<typeof requirementSchema>;
