/**
 * Phase 1 application order state machine.
 *
 * Authoritative persistence: `cart.status` (see migration
 * phase1_commerce_order_state.sql). Cart IS the Phase 1 application
 * order/transaction — no second competing lifecycle table.
 *
 * Payment states (PAYMENT_PENDING, etc.) are rejected here; they belong to Phase 8.
 */

import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";

/** Phase 1 application order states only. */
export const APPLICATION_ORDER_STATES = ["OPEN_CART", "CANCELLED"] as const;

export type ApplicationOrderState = (typeof APPLICATION_ORDER_STATES)[number];

/** Explicitly rejected payment/provider states (Phase 8+). */
export const PAYMENT_ORDER_STATES = [
  "CREATED",
  "PAYMENT_PENDING",
  "PAYMENT_VERIFIED",
  "PAYMENT_FAILED",
  "PAYMENT_CANCELLED",
  "PAYMENT_EXPIRED",
  "PAID",
  "POLICY_PENDING",
  "AUTHORIZED",
  "COMPLETED",
] as const;

const ALLOWED_TRANSITIONS: ReadonlyMap<
  ApplicationOrderState,
  ReadonlySet<ApplicationOrderState>
> = new Map([
  ["OPEN_CART", new Set<ApplicationOrderState>(["OPEN_CART", "CANCELLED"])],
  ["CANCELLED", new Set<ApplicationOrderState>(["CANCELLED"])],
]);

export function isApplicationOrderState(
  value: unknown,
): value is ApplicationOrderState {
  return (
    typeof value === "string" &&
    (APPLICATION_ORDER_STATES as readonly string[]).includes(value)
  );
}

export function isPaymentOrderState(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (PAYMENT_ORDER_STATES as readonly string[]).includes(value)
  );
}

/**
 * Deterministic transition check.
 * Same-state is allowed as an idempotent no-op.
 * CANCELLED → OPEN_CART is rejected.
 * Payment states are never valid targets/sources for Phase 1.
 */
export function canTransition(
  from: ApplicationOrderState,
  to: ApplicationOrderState,
): boolean {
  const allowed = ALLOWED_TRANSITIONS.get(from);
  if (!allowed) {
    return false;
  }
  return allowed.has(to);
}

/**
 * Validate and return the target state, or throw AppError.
 * Does not persist — callers write via repository after success.
 */
export function transition(
  from: unknown,
  to: unknown,
): ApplicationOrderState {
  if (isPaymentOrderState(from) || isPaymentOrderState(to)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message:
        "Payment order states are not valid Phase 1 application order transitions",
      statusCode: 400,
      details: { from, to },
    });
  }

  if (!isApplicationOrderState(from)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Invalid application order state (from)",
      statusCode: 400,
      details: { from },
    });
  }

  if (!isApplicationOrderState(to)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Invalid application order state (to)",
      statusCode: 400,
      details: { to },
    });
  }

  if (!canTransition(from, to)) {
    throw new AppError({
      code: ErrorCodes.CONFLICT,
      message: `Illegal application order transition: ${from} → ${to}`,
      statusCode: 409,
      details: { from, to },
    });
  }

  return to;
}

export function assertCanTransition(
  from: unknown,
  to: unknown,
): asserts to is ApplicationOrderState {
  transition(from, to);
}
