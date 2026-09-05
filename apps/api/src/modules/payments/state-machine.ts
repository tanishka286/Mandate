/**
 * Phase 8 Step 2 payment state machine.
 *
 * Deterministic payment state transitions.
 * Authoritative persistence: `payment.status` on public.payment.
 *
 * Payment states:
 *   - PAYMENT_PENDING: initial state upon payment attempt creation
 *   - VERIFIED: successful payment (terminal for current transaction)
 *   - FAILED: failed payment attempt (terminal)
 *   - CANCELLED: cancelled by user or system (terminal)
 *   - EXPIRED: checkout / payment window expired (terminal)
 *
 * Rules:
 *   - Same-state transition is an idempotent no-op.
 *   - PAYMENT_PENDING -> VERIFIED | FAILED | CANCELLED | EXPIRED
 *   - Terminal states (VERIFIED, FAILED, CANCELLED, EXPIRED) cannot transition to any other state.
 *   - Invalid transitions throw AppError with CONFLICT (409).
 *   - Neither AI nor frontend may mutate state to VERIFIED.
 */

import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";

export const PAYMENT_STATES = [
  "PAYMENT_PENDING",
  "VERIFIED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

export const TERMINAL_PAYMENT_STATES = [
  "VERIFIED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type TerminalPaymentState = (typeof TERMINAL_PAYMENT_STATES)[number];

const ALLOWED_PAYMENT_TRANSITIONS: ReadonlyMap<
  PaymentState,
  ReadonlySet<PaymentState>
> = new Map([
  [
    "PAYMENT_PENDING",
    new Set<PaymentState>([
      "PAYMENT_PENDING",
      "VERIFIED",
      "FAILED",
      "CANCELLED",
      "EXPIRED",
    ]),
  ],
  ["VERIFIED", new Set<PaymentState>(["VERIFIED"])],
  ["FAILED", new Set<PaymentState>(["FAILED"])],
  ["CANCELLED", new Set<PaymentState>(["CANCELLED"])],
  ["EXPIRED", new Set<PaymentState>(["EXPIRED"])],
]);

export function isPaymentState(value: unknown): value is PaymentState {
  return (
    typeof value === "string" &&
    (PAYMENT_STATES as readonly string[]).includes(value)
  );
}

export function isTerminalPaymentState(
  state: PaymentState,
): state is TerminalPaymentState {
  return (TERMINAL_PAYMENT_STATES as readonly string[]).includes(state);
}

/**
 * Deterministic transition check.
 * Same-state is allowed as an idempotent no-op.
 * Terminal states only allow same-state.
 */
export function canTransitionPaymentState(
  from: PaymentState,
  to: PaymentState,
): boolean {
  const allowed = ALLOWED_PAYMENT_TRANSITIONS.get(from);
  if (!allowed) {
    return false;
  }
  return allowed.has(to);
}

/**
 * Validate and return the target payment state, or throw AppError.
 */
export function transitionPaymentState(
  from: unknown,
  to: unknown,
): PaymentState {
  if (!isPaymentState(from)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Invalid payment state (from)",
      statusCode: 400,
      details: { from },
    });
  }

  if (!isPaymentState(to)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Invalid payment state (to)",
      statusCode: 400,
      details: { to },
    });
  }

  if (!canTransitionPaymentState(from, to)) {
    throw new AppError({
      code: ErrorCodes.CONFLICT,
      message: `Illegal payment state transition: ${from} → ${to}`,
      statusCode: 409,
      details: { from, to },
    });
  }

  return to;
}

export function assertCanTransitionPaymentState(
  from: unknown,
  to: unknown,
): asserts to is PaymentState {
  transitionPaymentState(from, to);
}
