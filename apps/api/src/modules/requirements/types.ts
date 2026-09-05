import type { Requirement, RequirementStatus } from "./schema.js";

export type { Requirement, RequirementStatus };

/** Row shape returned from Supabase `requirement` table. */
export interface RequirementRow {
  requirement_id: string;
  intent_id: string;
  item_name: string;
  target_quantity: number | string;
  unit: string;
  minimum_quality: string | null;
  constraints_json: unknown;
  confidence: number | string | null;
  status: string;
  created_at: string;
  updated_at: string;
}
