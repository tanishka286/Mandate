import type {
  ShoppingSession,
  ShoppingSessionStatus,
} from "./schema.js";

export type { ShoppingSession, ShoppingSessionStatus };

/** Row shape returned from Supabase `shopping_session` table. */
export interface ShoppingSessionRow {
  session_id: string;
  user_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}
