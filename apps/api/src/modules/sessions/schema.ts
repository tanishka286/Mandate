import { z } from "zod";

/**
 * Shopping session lifecycle statuses (Doc 07 §6.2 / Doc 08 §7 / §25).
 * ACTIVE → ENDED
 * Persistence only in Phase 3 Step 1 — no HTTP create/intent routes yet.
 */
export const SHOPPING_SESSION_STATUSES = ["ACTIVE", "ENDED"] as const;

export type ShoppingSessionStatus =
  (typeof SHOPPING_SESSION_STATUSES)[number];

export const shoppingSessionStatusSchema = z.enum(SHOPPING_SESSION_STATUSES);

/** Accepts UTC ISO timestamps from Postgres/Supabase (including fractional seconds). */
const isoUtcTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  });

export const sessionIdSchema = z.string().uuid();

export const userIdSchema = z.string().uuid();

/**
 * Persisted shopping_session row shape (Doc 07 §6.2).
 * ACTIVE requires ended_at null; ENDED requires ended_at set.
 * No currency/payment/intent fields — those live elsewhere or later steps.
 */
export const shoppingSessionSchema = z
  .object({
    session_id: sessionIdSchema,
    user_id: userIdSchema,
    status: shoppingSessionStatusSchema,
    started_at: isoUtcTimestampSchema,
    ended_at: isoUtcTimestampSchema.nullable(),
    created_at: isoUtcTimestampSchema,
  })
  .superRefine((value, ctx) => {
    if (value.status === "ACTIVE" && value.ended_at !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ended_at"],
        message: "ACTIVE sessions require ended_at to be null",
      });
    }
    if (value.status === "ENDED" && value.ended_at === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ended_at"],
        message: "ENDED sessions require ended_at to be set",
      });
    }
  });

export type ShoppingSession = z.infer<typeof shoppingSessionSchema>;
