import type {
  Mandate,
  MandateCategory,
  MandateStatus,
  MandateWithCategories,
} from "./schema.js";

export type {
  Mandate,
  MandateCategory,
  MandateStatus,
  MandateWithCategories,
};

/** Row shape returned from Supabase `mandate` table. */
export interface MandateRow {
  mandate_id: string;
  user_id: string;
  agent_id: string;
  max_spend_minor: number | string;
  currency: string;
  max_per_item_minor: number | string | null;
  purpose: string | null;
  valid_until: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Row shape returned from Supabase `mandate_category` table. */
export interface MandateCategoryRow {
  mandate_id: string;
  category: string;
}
