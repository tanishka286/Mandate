import { apiConfig } from "@/config/api";
import { PolicyEvaluationDeniedError } from "@/lib/policy-errors";
import type {
  ApiSuccessResponse,
  BasketQuoteData,
  BasketSelectionData,
  HealthData,
  ProductDetail,
  SessionAuditTrailData,
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

export interface DemoTokenData {
  token: string;
  user_id: string;
  mandate_id: string;
}

export interface CreateSessionData {
  session_id: string;
  status: "ACTIVE";
}

export interface CreateIntentData {
  intent_id: string;
  session_id: string;
  mandate_id: string;
  status: "CREATED";
}

export interface RunPlanData {
  session_id: string;
  intent_id: string;
  outcome: "COMPLETED" | "FAILED" | "CLARIFICATION_REQUIRED";
  optimization_run_id: string | null;
  best_value_basket_id: string | null;
  best_quality_basket_id: string | null;
  recommended_basket_type: "BEST_VALUE" | "BEST_QUALITY" | null;
  catalog_research_skipped: boolean;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
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

async function parsePolicyEvaluateError(res: Response): Promise<Error> {
  let message = `Request failed: ${res.status}`;
  let code = `HTTP_${res.status}`;
  let details: Record<string, unknown> = {};
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (body.error?.message) {
      message = body.error.message;
    }
    if (body.error?.code) {
      code = body.error.code;
    }
    if (body.error?.details) {
      details = body.error.details;
    }
  } catch {
    // ignore parse errors
  }

  if (res.status === 422) {
    return new PolicyEvaluationDeniedError({
      code,
      message,
      final_payable_minor:
        typeof details.final_payable_minor === "number"
          ? details.final_payable_minor
          : undefined,
      max_spend_minor:
        typeof details.max_spend_minor === "number"
          ? details.max_spend_minor
          : undefined,
      recoverable:
        typeof details.recoverable === "boolean" ? details.recoverable : undefined,
      policy_decision_id:
        typeof details.policy_decision_id === "string"
          ? details.policy_decision_id
          : undefined,
      policy_version:
        typeof details.policy_version === "string"
          ? details.policy_version
          : undefined,
    });
  }

  return new Error(message);
}

export async function fetchProductDetail(
  productId: string,
): Promise<ApiSuccessResponse<ProductDetail>> {
  const res = await fetch(`${apiConfig.baseUrl}/products/${productId}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<ProductDetail>;
}

export interface ProductEvidenceItem {
  evidence_id: string;
  source_type: string;
  summary: string;
  quality_signal: string;
  confidence: number;
}

export async function fetchProductEvidence(
  productId: string,
): Promise<ApiSuccessResponse<{ evidence: ProductEvidenceItem[] }>> {
  const res = await fetch(`${apiConfig.baseUrl}/products/${productId}/evidence`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<{ evidence: ProductEvidenceItem[] }>;
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
  idempotencyKey: string,
  input: {
    mandate_id: string;
    basket_id: string;
    quote_version: string;
  },
): Promise<ApiSuccessResponse<PolicyEvaluateAllowData>> {
  const res = await fetch(`${apiConfig.baseUrl}/policy/evaluate`, {
    method: "POST",
    headers: authHeaders(token, { "Idempotency-Key": idempotencyKey }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw await parsePolicyEvaluateError(res);
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

export async function fetchSessionAudit(
  sessionId: string,
  token: string,
): Promise<ApiSuccessResponse<SessionAuditTrailData>> {
  const res = await fetch(
    `${apiConfig.baseUrl}/sessions/${sessionId}/audit`,
    {
      headers: authHeaders(token),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<SessionAuditTrailData>;
}

export async function fetchDemoToken(): Promise<
  ApiSuccessResponse<DemoTokenData>
> {
  const res = await fetch(`${apiConfig.baseUrl}/demo/token`, {
    method: "POST",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<DemoTokenData>;
}

export async function createShoppingSession(
  token: string,
): Promise<ApiSuccessResponse<CreateSessionData>> {
  const res = await fetch(`${apiConfig.baseUrl}/sessions`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<CreateSessionData>;
}

export async function createShoppingIntent(
  sessionId: string,
  token: string,
  body: {
    goal_text: string;
    budget_minor: number | null;
    category: string;
    quality_preference: string | null;
    constraints: unknown[];
    mandate_id: string;
  },
): Promise<ApiSuccessResponse<CreateIntentData>> {
  const res = await fetch(`${apiConfig.baseUrl}/sessions/${sessionId}/intents`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<CreateIntentData>;
}

export async function runSessionPlan(
  sessionId: string,
  token: string,
  body: { intent_id: string },
): Promise<ApiSuccessResponse<RunPlanData>> {
  const res = await fetch(`${apiConfig.baseUrl}/sessions/${sessionId}/plan`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseApiError(res);
  }
  return (await res.json()) as ApiSuccessResponse<RunPlanData>;
}
