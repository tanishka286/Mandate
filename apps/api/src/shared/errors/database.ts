import { AppError } from "../errors/index.js";
import { ErrorCodes } from "../constants/index.js";

/**
 * Map PostgREST / Postgres errors into AppError without leaking internals.
 */
export function mapDatabaseError(
  error: unknown,
  fallbackMessage = "A database error occurred",
): AppError {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;

  // PostgreSQL unique_violation
  if (code === "23505") {
    return new AppError({
      code: ErrorCodes.CONFLICT,
      message: "Resource already exists",
      statusCode: 409,
      details: { constraint: "unique" },
    });
  }

  // PostgreSQL foreign_key_violation
  if (code === "23503") {
    return new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Referenced resource does not exist",
      statusCode: 400,
      details: { constraint: "foreign_key" },
    });
  }

  return new AppError({
    code: ErrorCodes.INTERNAL_ERROR,
    message: fallbackMessage,
    statusCode: 500,
    expose: false,
  });
}
