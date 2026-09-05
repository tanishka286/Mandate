import { z } from "zod";

/**
 * Mandate lifecycle statuses (Doc 06 / Doc 07).
 * CREATED → ACTIVE → EXPIRED | REVOKED | CLOSED
 * Persistence only in Phase 2 Step 1 — no policy evaluation yet.
 */
export const MANDATE_STATUSES = [
  "CREATED",
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "CLOSED",
] as const;

export type MandateStatus = (typeof MANDATE_STATUSES)[number];

export const mandateStatusSchema = z.enum(MANDATE_STATUSES);

/** Locked MVP currency. */
export const MANDATE_CURRENCY = "INR" as const;

export const mandateCurrencySchema = z.literal(MANDATE_CURRENCY);

/** Accepts UTC ISO timestamps from Postgres/Supabase (including fractional seconds). */
const isoUtcTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

export const mandateIdSchema = z.string().uuid();

export const userIdSchema = z.string().uuid();

export const agentIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "agent_id must not be empty",
  });

/** Integer minor-unit money (paise). Never floating point. */
export const moneyMinorSchema = z
  .number({
    invalid_type_error: "money must be an integer minor-unit amount",
  })
  .int("money must be an integer minor-unit amount")
  .nonnegative("money must be >= 0");

/** Optional per-item ceiling; null means no per-item limit. */
export const maxPerItemMinorSchema = moneyMinorSchema.nullable();

export const mandateCategoryLabelSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "category must not be empty",
  });

/**
 * Persisted mandate row shape (Doc 07 §8.1).
 * ACTIVE mandates require valid_until after created_at.
 */
export const mandateSchema = z
  .object({
    mandate_id: mandateIdSchema,
    user_id: userIdSchema,
    agent_id: agentIdSchema,
    max_spend_minor: moneyMinorSchema,
    currency: mandateCurrencySchema,
    max_per_item_minor: maxPerItemMinorSchema,
    purpose: z.string().nullable(),
    valid_until: isoUtcTimestampSchema,
    status: mandateStatusSchema,
    created_at: isoUtcTimestampSchema,
    updated_at: isoUtcTimestampSchema,
  })
  .superRefine((value, ctx) => {
    if (value.status !== "ACTIVE") {
      return;
    }
    const validUntilMs = Date.parse(value.valid_until);
    const createdAtMs = Date.parse(value.created_at);
    if (!(validUntilMs > createdAtMs)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valid_until"],
        message:
          "ACTIVE mandates require valid_until later than created_at",
      });
    }
  });

export type Mandate = z.infer<typeof mandateSchema>;

/** Normalized allow-list category row (Doc 07 §8.2). */
export const mandateCategorySchema = z.object({
  mandate_id: mandateIdSchema,
  category: mandateCategoryLabelSchema,
});

export type MandateCategory = z.infer<typeof mandateCategorySchema>;

/**
 * Domain mandate for authorization/read paths (Doc 08 shape + ownership fields).
 * Categories come from mandate_category — never a mutable JSON blob on the row.
 */
export const mandateWithCategoriesSchema = z
  .object({
    mandate_id: mandateIdSchema,
    user_id: userIdSchema,
    agent_id: agentIdSchema,
    max_spend_minor: moneyMinorSchema,
    currency: mandateCurrencySchema,
    max_per_item_minor: maxPerItemMinorSchema,
    purpose: z.string().nullable(),
    valid_until: isoUtcTimestampSchema,
    status: mandateStatusSchema,
    allowed_categories: z.array(mandateCategoryLabelSchema),
    created_at: isoUtcTimestampSchema,
    updated_at: isoUtcTimestampSchema,
  })
  .superRefine((value, ctx) => {
    if (value.status !== "ACTIVE") {
      return;
    }
    const validUntilMs = Date.parse(value.valid_until);
    const createdAtMs = Date.parse(value.created_at);
    if (!(validUntilMs > createdAtMs)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valid_until"],
        message:
          "ACTIVE mandates require valid_until later than created_at",
      });
    }
  });

export type MandateWithCategories = z.infer<typeof mandateWithCategoriesSchema>;
