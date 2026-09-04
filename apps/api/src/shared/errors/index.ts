import type { ErrorCode } from "../constants/index.js";
import { ErrorCodes } from "../constants/index.js";

export class AppError extends Error {
  readonly code: ErrorCode | string;
  readonly statusCode: number;
  readonly details: Record<string, unknown>;
  readonly expose: boolean;

  constructor(options: {
    code: ErrorCode | string;
    message: string;
    statusCode?: number;
    details?: Record<string, unknown>;
    expose?: boolean;
  }) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details ?? {};
    this.expose = options.expose ?? true;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toSafeClientMessage(error: unknown): {
  code: string;
  message: string;
  details: Record<string, unknown>;
  statusCode: number;
} {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.expose ? error.message : "An unexpected error occurred",
      details: error.expose ? error.details : {},
      statusCode: error.statusCode,
    };
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === "VALIDATION_ERROR"
  ) {
    const e = error as unknown as {
      message?: string;
      details?: Record<string, unknown>;
      statusCode?: number;
    };
    return {
      code: ErrorCodes.VALIDATION_ERROR,
      message: e.message || "Validation failed",
      details: e.details ?? {},
      statusCode: e.statusCode ?? 400,
    };
  }

  return {
    code: ErrorCodes.INTERNAL_ERROR,
    message: "An unexpected error occurred",
    details: {},
    statusCode: 500,
  };
}
