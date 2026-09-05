import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type { MandateCategoryRow, MandateRow } from "./types.js";

/**
 * Mandate repository — Phase 2 Step 2.
 * Persistence reads only. No business/authorization logic.
 * No AI-facing or public mutation surface.
 */
export class MandateRepository {
  async findById(mandateId: string): Promise<MandateRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("mandate")
      .select(
        `
        mandate_id,
        user_id,
        agent_id,
        max_spend_minor,
        currency,
        max_per_item_minor,
        purpose,
        valid_until,
        status,
        created_at,
        updated_at
      `,
      )
      .eq("mandate_id", mandateId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load mandate");
    }

    return (data as MandateRow | null) ?? null;
  }

  /**
   * Ownership-scoped read: mandate_id alone is never enough for another user.
   */
  async findByIdForUser(
    mandateId: string,
    userId: string,
  ): Promise<MandateRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("mandate")
      .select(
        `
        mandate_id,
        user_id,
        agent_id,
        max_spend_minor,
        currency,
        max_per_item_minor,
        purpose,
        valid_until,
        status,
        created_at,
        updated_at
      `,
      )
      .eq("mandate_id", mandateId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load mandate");
    }

    return (data as MandateRow | null) ?? null;
  }

  async listCategoriesByMandateId(
    mandateId: string,
  ): Promise<MandateCategoryRow[]> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("mandate_category")
      .select("mandate_id, category")
      .eq("mandate_id", mandateId)
      .order("category", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to load mandate categories");
    }

    return (data ?? []) as MandateCategoryRow[];
  }
}
