import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import type { QualityEvidenceRow } from "./types.js";

const QUALITY_EVIDENCE_SELECT = `
  evidence_id,
  product_id,
  sku_id,
  source_type,
  source_reference,
  summary,
  quality_signal,
  confidence,
  captured_at,
  expires_at,
  created_at
`;

/**
 * Research / quality evidence repository — Phase 4.
 * Persistence reads only. Writes remain backend-controlled (seed) —
 * AI must never mutate quality_evidence.
 */
export class ResearchRepository {
  async findById(evidenceId: string): Promise<QualityEvidenceRow | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("quality_evidence")
      .select(QUALITY_EVIDENCE_SELECT)
      .eq("evidence_id", evidenceId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load quality evidence");
    }

    return (data as QualityEvidenceRow | null) ?? null;
  }

  /**
   * All evidence rows for a product (including expired), deterministic order:
   * newest captured_at first, evidence_id ascending as tie-breaker.
   */
  async listByProductId(productId: string): Promise<QualityEvidenceRow[]> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("quality_evidence")
      .select(QUALITY_EVIDENCE_SELECT)
      .eq("product_id", productId)
      .order("captured_at", { ascending: false })
      .order("evidence_id", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to load quality evidence");
    }

    return (data ?? []) as QualityEvidenceRow[];
  }

  /** Lightweight product existence check for evidence retrieval. */
  async productExists(productId: string): Promise<boolean> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("product")
      .select("product_id")
      .eq("product_id", productId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to verify product for evidence");
    }

    return data !== null;
  }
}
