/**
 * Shared API contract types for Mandate.
 * Phase 0: response envelopes and foundational identifiers only.
 */

export interface ApiMeta {
  request_id: string;
}

export interface ApiSuccessResponse<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  request_id: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export interface HealthData {
  status: "ok";
}

/** Money is always integer minor units (paise for INR). ?1 = 100. */
export type MoneyMinor = number;

export type IsoUtcTimestamp = string;
