import type {
  PolicyDecision,
  PolicyDecisionOutcome,
  PolicyEvaluateAllowData,
  PolicyEvaluateHttpBody,
  PolicyEvaluateRequest,
  PolicyEvaluationResult,
  PolicyReasonCode,
  PolicyRevalidationRequest,
} from "./schema.js";
import type {
  AuthoritativeSkuSnapshot,
  IncentivePort,
  PolicyCatalogPort,
  PolicyLineRequest,
} from "./ports.js";
import type { PolicyRevalidationPort } from "./revalidation-service.js";

export type {
  AuthoritativeSkuSnapshot,
  IncentivePort,
  PolicyCatalogPort,
  PolicyDecision,
  PolicyDecisionOutcome,
  PolicyEvaluateAllowData,
  PolicyEvaluateHttpBody,
  PolicyEvaluateRequest,
  PolicyEvaluationResult,
  PolicyLineRequest,
  PolicyReasonCode,
  PolicyRevalidationPort,
  PolicyRevalidationRequest,
};

/** Row shape returned from Supabase `policy_decision` table. */
export interface PolicyDecisionRow {
  policy_decision_id: string;
  /** Authenticated principal; null only on pre-idempotency historical rows. */
  user_id: string | null;
  mandate_id: string;
  /** Future Doc 07 basket_id; FK deferred until public.basket exists. */
  basket_id: string;
  decision: string;
  reason_code: string | null;
  gross_amount_minor: number | string;
  discount_amount_minor: number | string;
  final_payable_minor: number | string;
  max_spend_minor: number | string;
  policy_version: string;
  evaluated_at: string;
  request_id: string;
  idempotency_key: string | null;
  request_fingerprint: string | null;
  created_at: string;
}
