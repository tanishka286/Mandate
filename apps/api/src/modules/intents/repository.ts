import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type { ShoppingIntentRow } from "./types.js";

export interface ShoppingIntentInsertInput {
  intent_id?: string;
  session_id: string;
  mandate_id: string;
  goal_text: string;
  category: string;
  budget_minor: number | null;
  quality_preference: string | null;
  status?: string;
  assumptions_json?: unknown[];
}

/**
 * Shopping intent repository — Phase 3 Step 4.
 * Persistence only. Session/mandate authority checks live in the service.
 */
export class IntentsRepository {
  async findById(intentId: string): Promise<ShoppingIntentRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("shopping_intent")
      .select(
        `
        intent_id,
        session_id,
        mandate_id,
        goal_text,
        category,
        budget_minor,
        quality_preference,
        status,
        assumptions_json,
        created_at,
        updated_at
      `,
      )
      .eq("intent_id", intentId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load shopping intent");
    }

    return (data as ShoppingIntentRow | null) ?? null;
  }

  async insert(input: ShoppingIntentInsertInput): Promise<ShoppingIntentRow> {
    const db = getSupabaseClient();
    const row: Record<string, unknown> = {
      session_id: input.session_id,
      mandate_id: input.mandate_id,
      goal_text: input.goal_text,
      category: input.category,
      budget_minor: input.budget_minor,
      quality_preference: input.quality_preference,
      status: input.status ?? "CREATED",
      assumptions_json: input.assumptions_json ?? [],
    };
    if (input.intent_id !== undefined) {
      row.intent_id = input.intent_id;
    }

    const { data, error } = await db
      .from("shopping_intent")
      .insert(row)
      .select(
        `
        intent_id,
        session_id,
        mandate_id,
        goal_text,
        category,
        budget_minor,
        quality_preference,
        status,
        assumptions_json,
        created_at,
        updated_at
      `,
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert shopping intent");
    }

    return data as ShoppingIntentRow;
  }

  /**
   * Update planning metadata after successful requirement extraction.
   * Does not mutate mandate_id or goal_text.
   */
  async updateExtractionState(
    intentId: string,
    input: {
      status: string;
      assumptions_json: unknown[];
    },
  ): Promise<ShoppingIntentRow> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("shopping_intent")
      .update({
        status: input.status,
        assumptions_json: input.assumptions_json,
        updated_at: new Date().toISOString(),
      })
      .eq("intent_id", intentId)
      .select(
        `
        intent_id,
        session_id,
        mandate_id,
        goal_text,
        category,
        budget_minor,
        quality_preference,
        status,
        assumptions_json,
        created_at,
        updated_at
      `,
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to update shopping intent");
    }

    return data as ShoppingIntentRow;
  }
}
