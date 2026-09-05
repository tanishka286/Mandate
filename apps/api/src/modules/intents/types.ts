import type {
  CreateShoppingIntentBody,
  CreateShoppingIntentData,
  SessionIdParams,
  ShoppingIntent,
  ShoppingIntentStatus,
} from "./schema.js";

export type {
  CreateShoppingIntentBody,
  CreateShoppingIntentData,
  SessionIdParams,
  ShoppingIntent,
  ShoppingIntentStatus,
};

/** Row shape returned from Supabase `shopping_intent` table. */
export interface ShoppingIntentRow {
  intent_id: string;
  session_id: string;
  mandate_id: string;
  goal_text: string;
  category: string;
  budget_minor: number | string | null;
  quality_preference: string | null;
  status: string;
  assumptions_json: unknown;
  created_at: string;
  updated_at: string;
}
