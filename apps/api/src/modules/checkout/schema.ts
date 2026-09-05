import { z } from "zod";

/**
 * Strict schema for internal checkout service input.
 * Rejects any client-supplied financial fields (amount, discount, final_payable_minor, status, etc.).
 */
export const checkoutInputSchema = z
  .object({
    user_id: z.string().uuid(),
    session_id: z.string().uuid(),
    selection_id: z.string().uuid(),
    policy_decision_id: z.string().uuid(),
    idempotency_key: z
      .string()
      .min(1)
      .refine((v) => v.trim().length > 0, {
        message: "idempotency_key must not be empty",
      }),
    request_id: z.string().trim().min(1).optional(),
  })
  .strict();

export type ValidatedCheckoutInput = z.infer<typeof checkoutInputSchema>;
