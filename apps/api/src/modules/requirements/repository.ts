import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type { RequirementRow } from "./types.js";

export interface RequirementInsertInput {
  requirement_id?: string;
  intent_id: string;
  item_name: string;
  target_quantity: number;
  unit: string;
  minimum_quality: string | null;
  constraints_json?: unknown[];
  confidence: number | null;
  status?: string;
}

/**
 * Requirement repository — Phase 3 Step 5.
 * Persistence only. Extraction/ownership logic lives in the service.
 */
export class RequirementsRepository {
  async listByIntentId(intentId: string): Promise<RequirementRow[]> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("requirement")
      .select(
        `
        requirement_id,
        intent_id,
        item_name,
        target_quantity,
        unit,
        minimum_quality,
        constraints_json,
        confidence,
        status,
        created_at,
        updated_at
      `,
      )
      .eq("intent_id", intentId)
      .order("created_at", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to load requirements");
    }

    return (data ?? []) as RequirementRow[];
  }

  /**
   * Insert multiple requirements in one statement (atomic for the batch).
   * Callers must validate drafts before insert.
   */
  async insertMany(
    inputs: RequirementInsertInput[],
  ): Promise<RequirementRow[]> {
    if (inputs.length === 0) {
      return [];
    }

    const db = getSupabaseClient();
    const rows = inputs.map((input) => {
      const row: Record<string, unknown> = {
        intent_id: input.intent_id,
        item_name: input.item_name,
        target_quantity: input.target_quantity,
        unit: input.unit,
        minimum_quality: input.minimum_quality,
        constraints_json: input.constraints_json ?? [],
        confidence: input.confidence,
        status: input.status ?? "CREATED",
      };
      if (input.requirement_id !== undefined) {
        row.requirement_id = input.requirement_id;
      }
      return row;
    });

    const { data, error } = await db
      .from("requirement")
      .insert(rows)
      .select(
        `
        requirement_id,
        intent_id,
        item_name,
        target_quantity,
        unit,
        minimum_quality,
        constraints_json,
        confidence,
        status,
        created_at,
        updated_at
      `,
      );

    if (error) {
      throw mapDatabaseError(error, "Failed to insert requirements");
    }

    return (data ?? []) as RequirementRow[];
  }
}
