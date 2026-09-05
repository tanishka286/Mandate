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

export interface PolicyEvaluateAllowData {
  policy_decision_id: string;
  decision: "ALLOW";
  reason_code: "AUTHORIZED";
  final_payable_minor: number;
  policy_version: string;
}

export interface CheckoutResponseData {
  order_id: string;
  razorpay_order_id: string;
  amount_minor: number;
  currency: "INR";
  status: "PAYMENT_PENDING";
  razorpay_key_id?: string;
}

export interface VerifyPaymentResult {
  payment_id: string;
  order_id: string;
  status: "VERIFIED";
  razorpay_payment_id: string;
  amount_minor: number;
  verified_at: string;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

function authHeaders(
  token?: string,
  extra?: Record<string, string>,
): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(extra ?? {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function parseApiError(res: Response): Promise<Error> {
  let message = `Request failed: ${res.status}`;
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (body.error?.message) {
      message = body.error.message;
    }
  } catch {
    // ignore parse errors
  }
  return new Error(message);
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
    throw await parseApiError(res);
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
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<BasketSelectionData>;
}

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
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<BasketQuoteData>;
}

export async function evaluatePolicy(
  token: string,
  input: {
    mandate_id: string;
    basket_id: string;
    quote_version: string;
  },
): Promise<ApiSuccessResponse<PolicyEvaluateAllowData>> {
  const res = await fetch(`${apiConfig.baseUrl}/policy/evaluate`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<PolicyEvaluateAllowData>;
}

export async function createCheckout(
  token: string,
  idempotencyKey: string,
  input: {
    selection_id: string;
    policy_decision_id: string;
  },
): Promise<ApiSuccessResponse<CheckoutResponseData>> {
  const res = await fetch(`${apiConfig.baseUrl}/checkout`, {
    method: "POST",
    headers: authHeaders(token, { "Idempotency-Key": idempotencyKey }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<CheckoutResponseData>;
}

export async function verifyPayment(
  token: string,
  input: {
    order_id: string;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  },
): Promise<ApiSuccessResponse<VerifyPaymentResult>> {
  const res = await fetch(`${apiConfig.baseUrl}/payments/verify`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<VerifyPaymentResult>;
}
