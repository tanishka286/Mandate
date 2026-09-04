import { apiConfig } from "@/config/api";
import type { ApiSuccessResponse, HealthData } from "@mandate/types";

/**
 * Thin API client. All authoritative commerce data flows through the Express backend.
 */
export async function fetchHealth(): Promise<ApiSuccessResponse<HealthData>> {
  const res = await fetch(`${apiConfig.baseUrl}/health`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }

  return (await res.json()) as ApiSuccessResponse<HealthData>;
}
