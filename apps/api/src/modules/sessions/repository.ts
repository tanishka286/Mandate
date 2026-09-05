import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type { ShoppingSessionRow } from "./types.js";

export interface ShoppingSessionInsertInput {
  session_id?: string;
  user_id: string;
  status?: string;
  started_at?: string;
  ended_at?: string | null;
}

/**
 * Shopping session repository — Phase 3 Step 4.
 * Persistence reads/writes only. Ownership and ACTIVE checks live in the service.
 */
export class SessionsRepository {
  async findById(sessionId: string): Promise<ShoppingSessionRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("shopping_session")
      .select(
        "session_id, user_id, status, started_at, ended_at, created_at",
      )
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load shopping session");
    }

    return (data as ShoppingSessionRow | null) ?? null;
  }

  /**
   * Persist a shopping session row (tests / later POST /sessions).
   * Not exposed as HTTP in Phase 3 Step 4.
   */
  async insert(input: ShoppingSessionInsertInput): Promise<ShoppingSessionRow> {
    const db = getSupabaseClient();
    const row: Record<string, unknown> = {
      user_id: input.user_id,
      status: input.status ?? "ACTIVE",
    };
    if (input.session_id !== undefined) {
      row.session_id = input.session_id;
    }
    if (input.started_at !== undefined) {
      row.started_at = input.started_at;
    }
    if (input.ended_at !== undefined) {
      row.ended_at = input.ended_at;
    }

    const { data, error } = await db
      .from("shopping_session")
      .insert(row)
      .select(
        "session_id, user_id, status, started_at, ended_at, created_at",
      )
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert shopping session");
    }

    return data as ShoppingSessionRow;
  }
}
