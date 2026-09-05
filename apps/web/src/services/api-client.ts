import { apiConfig } from "@/config/api";
import type {
  ApiSuccessResponse,
  BasketQuoteData,
  BasketSelectionData,
  HealthData,
  SessionBasketsData,
} from "@mandate/types";

/**
 * Thin API client. All authoritative commerce data flows through the Express backend.
 * Frontend never sets final_payable, policy decisions, or payment state.
 */

function authHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

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

export async function fetchSessionBaskets(
  sessionId: string,
  token: string,
): Promise<ApiSuccessResponse<SessionBasketsData>> {
  const res = await fetch(
    `${apiConfig.baseUrl}/sessions/${sessionId}/baskets`,
    {
      headers: authHeaders(token),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to load baskets: ${res.status}`);
  }
  return (await res.json()) as ApiSuccessResponse<SessionBasketsData>;
}

export async function selectBasket(
  sessionId: string,
  basketId: string,
  token: string,
): Promise<ApiSuccessResponse<BasketSelectionData>> {
  const res = await fetch(
    `${apiConfig.baseUrl}/sessions/${sessionId}/basket-selections`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        basket_id: basketId,
        selection_source: "USER",
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Basket selection failed: ${res.status}`);
  }
  return (await res.json()) as ApiSuccessResponse<BasketSelectionData>;
}

/**
 * Requests a fresh server-authoritative quote.
 * Never sends client totals as authority — optional client_claims are ignored by API.
 */
export async function createBasketQuote(
  basketId: string,
  token: string,
): Promise<ApiSuccessResponse<BasketQuoteData>> {
  const res = await fetch(`${apiConfig.baseUrl}/baskets/${basketId}/quote`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`Fresh quote failed: ${res.status}`);
  }
  return (await res.json()) as ApiSuccessResponse<BasketQuoteData>;
}
