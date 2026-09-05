import { z } from "zod";

/**
 * Shopping intent lifecycle statuses (Doc 07 §9.1 / Doc 08 §8 / §25).
 * CREATED → PLANNING
 * Persistence only in Phase 3 Step 2 — no requirement extraction yet.
 */
export const SHOPPING_INTENT_STATUSES = ["CREATED", "PLANNING"] as const;

export type ShoppingIntentStatus =
  (typeof SHOPPING_INTENT_STATUSES)[number];

export const shoppingIntentStatusSchema = z.enum(SHOPPING_INTENT_STATUSES);

/** Accepts UTC ISO timestamps from Postgres/Supabase (including fractional seconds). */
const isoUtcTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

export const intentIdSchema = z.string().uuid();

export const sessionIdSchema = z.string().uuid();

export const mandateIdSchema = z.string().uuid();

export const goalTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "goal_text must not be empty",
  });

/** Planning category label (e.g. grocery). Not a catalog taxonomy. */
export const intentCategorySchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "category must not be empty",
  });

/**
 * Optional user-stated planning budget in integer INR paise.
 * Not an authoritative authorization ceiling (mandate owns that).
 */
export const budgetMinorSchema = z
  .number({
    invalid_type_error: "budget_minor must be an integer minor-unit amount",
  })
  .int("budget_minor must be an integer minor-unit amount")
  .nonnegative("budget_minor must be >= 0")
  .nullable();

/** Optional quality preference; null when not supplied. */
export const qualityPreferenceSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "quality_preference must not be empty when provided",
  })
  .nullable();

/**
 * Explicit assumptions associated with the intent.
 * Default empty array — not structured requirements, not financial authority.
 */
export const assumptionsJsonSchema = z.array(z.unknown());

/**
 * Persisted shopping_intent row shape (Doc 07 §9.1).
 * No requirements, prices, policy, basket, or payment fields.
 */
export const shoppingIntentSchema = z
  .object({
    intent_id: intentIdSchema,
    session_id: sessionIdSchema,
    mandate_id: mandateIdSchema,
    goal_text: goalTextSchema,
    category: intentCategorySchema,
    budget_minor: budgetMinorSchema,
    quality_preference: qualityPreferenceSchema,
    status: shoppingIntentStatusSchema,
    assumptions_json: assumptionsJsonSchema,
    created_at: isoUtcTimestampSchema,
    updated_at: isoUtcTimestampSchema,
  })
  .strict();

export type ShoppingIntent = z.infer<typeof shoppingIntentSchema>;

/** Route params for POST /sessions/:session_id/intents. */
export const sessionIdParamsSchema = z.object({
  session_id: sessionIdSchema,
});

export type SessionIdParams = z.infer<typeof sessionIdParamsSchema>;

/**
 * Request constraints from Doc 08 create-intent body.
 * Validated as a structured array only — shopping_intent has no constraints column.
 * Must NOT be written into assumptions_json (Doc 07 assumptions ≠ request constraints).
 */
export const intentConstraintsSchema = z.array(z.unknown());

/**
 * POST /sessions/{session_id}/intents body (Doc 08 §8.1).
 *
 * mandate_id: required for safe resolution. Doc 08 example omits it, but:
 * - Doc 02: user provides the mandate
 * - Doc 08 §22: mandate_id must belong to user and be active
 * - Seed fixtures allow multiple ACTIVE mandates per user (A and B)
 * Auto-picking an ACTIVE mandate would invent authority behavior.
 */
export const createShoppingIntentBodySchema = z
  .object({
    goal_text: goalTextSchema,
    budget_minor: budgetMinorSchema.optional(),
    category: intentCategorySchema,
    quality_preference: qualityPreferenceSchema.optional(),
    constraints: intentConstraintsSchema,
    mandate_id: mandateIdSchema,
  })
  .strict();

export type CreateShoppingIntentBody = z.infer<
  typeof createShoppingIntentBodySchema
>;

/** Doc 08 create-intent response data. */
export const createShoppingIntentDataSchema = z
  .object({
    intent_id: intentIdSchema,
    session_id: sessionIdSchema,
    mandate_id: mandateIdSchema,
    status: z.literal("CREATED"),
  })
  .strict();

export type CreateShoppingIntentData = z.infer<
  typeof createShoppingIntentDataSchema
>;
