import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import {
  incentiveRowSchema,
  incentiveEvaluationRowSchema,
  persistIncentiveEvaluationInputSchema,
  type IncentiveRow,
  type IncentiveEvaluationRow,
  type PersistIncentiveEvaluationInput,
} from "./schema.js";

/**
 * Authoritative incentive persistence (Doc 07).
 * Loads server-side facts only — never trusts client/AI input.
 */
export class IncentivesRepository {
  constructor(private readonly db = getSupabaseClient()) {}

  async findById(incentiveId: string): Promise<IncentiveRow | null> {
    const { data, error } = await this.db
      .from("incentive")
      .select(
        "incentive_id, type, name, description, status, valid_from, valid_until, rules_json, created_at, updated_at",
      )
      .eq("incentive_id", incentiveId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load incentive");
    }
    if (!data) {
      return null;
    }
    return parseOrThrow(incentiveRowSchema, data);
  }

  async findByIds(incentiveIds: readonly string[]): Promise<IncentiveRow[]> {
    if (incentiveIds.length === 0) {
      return [];
    }
    const unique = [...new Set(incentiveIds)];
    const { data, error } = await this.db
      .from("incentive")
      .select(
        "incentive_id, type, name, description, status, valid_from, valid_until, rules_json, created_at, updated_at",
      )
      .in("incentive_id", unique);

    if (error) {
      throw mapDatabaseError(error, "Failed to load incentives");
    }

    return (data ?? []).map((row) => parseOrThrow(incentiveRowSchema, row));
  }

  async listActive(): Promise<IncentiveRow[]> {
    const { data, error } = await this.db
      .from("incentive")
      .select(
        "incentive_id, type, name, description, status, valid_from, valid_until, rules_json, created_at, updated_at",
      )
      .eq("status", "ACTIVE")
      .order("incentive_id", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to list active incentives");
    }

    return (data ?? []).map((row) => parseOrThrow(incentiveRowSchema, row));
  }

  async createEvaluation(
    input: PersistIncentiveEvaluationInput,
  ): Promise<IncentiveEvaluationRow> {
    const parsed = parseOrThrow(persistIncentiveEvaluationInputSchema, input);
    const { data, error } = await this.db
      .from("incentive_evaluation")
      .insert({
        optimization_run_id: parsed.optimization_run_id,
        basket_id: parsed.basket_id ?? null,
        incentive_id: parsed.incentive_id,
        decision: parsed.decision,
        current_saving_minor: parsed.current_saving_minor,
        future_value_minor: parsed.future_value_minor ?? null,
        reason: parsed.reason ?? null,
        eligibility_snapshot: parsed.eligibility_snapshot ?? {},
      })
      .select(
        "evaluation_id, optimization_run_id, basket_id, incentive_id, decision, current_saving_minor, future_value_minor, reason, eligibility_snapshot, created_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to persist incentive evaluation");
    }

    return parseOrThrow(incentiveEvaluationRowSchema, data);
  }
}
