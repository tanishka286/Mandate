export const REQUEST_ID_HEADER = "x-request-id";
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
export const AUTHORIZATION_HEADER = "authorization";

export const ErrorCodes = {
  INTERNAL_ERROR: "INTERNAL_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  IDEMPOTENCY_REQUIRED: "IDEMPOTENCY_REQUIRED",
  /** Same Idempotency-Key reused with a materially different request (Doc 08). */
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  STOCK_UNAVAILABLE: "STOCK_UNAVAILABLE",
  /** Mandate missing for the requested id. */
  MANDATE_NOT_FOUND: "MANDATE_NOT_FOUND",
  /** Mandate exists but does not belong to the authenticated context. */
  MANDATE_UNAUTHORIZED: "MANDATE_UNAUTHORIZED",
  /** Mandate cannot authorize (inactive, expired, revoked, closed, etc.). */
  MANDATE_INVALID: "MANDATE_INVALID",
  /** Persisted quote no longer matches current basket/catalog/incentive state. */
  QUOTE_STALE: "QUOTE_STALE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
