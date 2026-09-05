import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import { isAppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import type { PolicyDecisionRow } from "./types.js";

export interface PolicyDecisionInsertInput {
  policy_decision_id?: string;
  user_id: string;
  mandate_id: string;
  basket_id: string;
  decision: "ALLOW" | "DENY";
  reason_code: string | null;
  gross_amount_minor: number;
  discount_amount_minor: number;
  final_payable_minor: number;
  max_spend_minor: number;
  policy_version: string;
  evaluated_at: string;
  request_id: string;
  idempotency_key: string;
  request_fingerprint: string;
}

const DECISION_SELECT = `
  policy_decision_id,
  user_id,
  mandate_id,
  basket_id,
  decision,
  reason_code,
  gross_amount_minor,
  discount_amount_minor,
  final_payable_minor,
  max_spend_minor,
  policy_version,
  evaluated_at,
  request_id,
  idempotency_key,
  request_fingerprint,
  created_at
`;

/**
 * Policy repository — Phase 2.
 * Inserts immutable historical decisions. No update/delete.
 */
export class PolicyRepository {
  async insertDecision(
    input: PolicyDecisionInsertInput,
  ): Promise<PolicyDecisionRow> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("policy_decision")
      .insert({
        policy_decision_id: input.policy_decision_id,
        user_id: input.user_id,
        mandate_id: input.mandate_id,
        basket_id: input.basket_id,
        decision: input.decision,
        reason_code: input.reason_code,
        gross_amount_minor: input.gross_amount_minor,
        discount_amount_minor: input.discount_amount_minor,
        final_payable_minor: input.final_payable_minor,
        max_spend_minor: input.max_spend_minor,
        policy_version: input.policy_version,
        evaluated_at: input.evaluated_at,
        request_id: input.request_id,
        idempotency_key: input.idempotency_key,
        request_fingerprint: input.request_fingerprint,
      })
      .select(DECISION_SELECT)
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to persist policy decision");
    }

    return data as PolicyDecisionRow;
  }

  async findById(
    policyDecisionId: string,
  ): Promise<PolicyDecisionRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("policy_decision")
      .select(DECISION_SELECT)
      .eq("policy_decision_id", policyDecisionId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load policy decision");
    }

    return (data as PolicyDecisionRow | null) ?? null;
  }

  /**
   * Lookup within authenticated user scope only — never by key alone.
   */
  async findByUserIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<PolicyDecisionRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("policy_decision")
      .select(DECISION_SELECT)
      .eq("user_id", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load policy decision by idempotency key");
    }

    return (data as PolicyDecisionRow | null) ?? null;
  }

  /** Resolve shopping session for basket-scoped audit correlation (Phase 10). */
  async findBasketSessionId(basketId: string): Promise<string | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("basket")
      .select("session_id")
      .eq("basket_id", basketId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load basket session for policy audit");
    }

    return typeof data?.session_id === "string" ? data.session_id : null;
  }
}

export function isUniqueConstraintConflict(error: unknown): boolean {
  if (isAppError(error) && error.code === ErrorCodes.CONFLICT) {
    return true;
  }
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code) === "23505";
  }
  return false;
}
