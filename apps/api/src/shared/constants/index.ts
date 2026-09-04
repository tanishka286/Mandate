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
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
