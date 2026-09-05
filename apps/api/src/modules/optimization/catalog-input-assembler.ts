import type { CatalogSearchItem } from "../catalog/schema.js";
import type { ExtractedRequirementDraft } from "../requirements/extraction-schema.js";
import type { QualityEvidence } from "../research/schema.js";
import type { QualitySignal } from "../research/schema.js";
import { isCatalogCategoryAllowedForMandate } from "../policy/category-normalization.js";
import { assessFromCurrentEvidence } from "../research/quality-assessor.js";
import { toPackCandidateInput } from "./pack-optimization.js";
import type { BestValueRequirementSlot } from "./best-value.js";
import type { BestValueInput } from "./best-value.js";
import type {
  OptimizationCandidate,
  PackCandidateInput,
  PackQualitySnapshot,
} from "./schema.js";
import type { Clarification } from "../requirements/extraction-schema.js";

export type RequirementCatalogSlot = {
  draft: ExtractedRequirementDraft;
  searchItems: CatalogSearchItem[];
  evidenceByProductId: ReadonlyMap<string, readonly QualityEvidence[]>;
};

export type CatalogAssemblyResult =
  | { status: "SUCCESS"; input: BestValueInput }
  | { status: "CLARIFICATION_REQUIRED"; clarification: Clarification };

export function buildOptimizationInputFromCatalog(args: {
  slots: RequirementCatalogSlot[];
  budget_minor: number;
  allowed_categories: readonly string[];
}): CatalogAssemblyResult {
  const requirementSlots: BestValueRequirementSlot[] = [];
  const missingItems: string[] = [];

  for (const slot of args.slots) {
    if (slot.searchItems.length === 0) {
      missingItems.push(slot.draft.item_name);
      continue;
    }

    const packCandidates: PackCandidateInput[] = [];
    const seenSku = new Set<string>();

    for (const item of slot.searchItems) {
      if (seenSku.has(item.sku_id)) {
        continue;
      }
      seenSku.add(item.sku_id);

      if (
        args.allowed_categories.length > 0 &&
        !isCatalogCategoryAllowedForMandate(
          item.category_code,
          args.allowed_categories,
        )
      ) {
        continue;
      }

      const evidence =
        slot.evidenceByProductId.get(item.product_id) ?? [];
      const assessment = assessFromCurrentEvidence(
        {
          product_id: item.product_id,
          sku_id: item.sku_id,
          minimum_quality: slot.draft.minimum_quality as QualitySignal | null,
        },
        evidence,
      );

      const quality: PackQualitySnapshot = {
        quality_signal: assessment.quality_signal,
        confidence: assessment.confidence,
        evidence_refs: [...assessment.evidence_refs],
        evidence_status: assessment.evidence_status,
        meets_minimum_quality: assessment.meets_minimum_quality,
      };

      const candidate: OptimizationCandidate = {
        product_id: item.product_id,
        sku_id: item.sku_id,
        product_name: item.name,
        brand: item.brand,
        category_code: item.category_code,
        product_status: item.product_status,
        sku_status: item.sku_status,
        sku_code: item.sku_code,
        pack_quantity: item.pack_quantity,
        pack_unit: item.pack_unit,
        price_minor: item.price_minor,
        currency: item.currency,
        stock_available: item.stock_available,
      };

      packCandidates.push(toPackCandidateInput(candidate, quality));
    }

    if (packCandidates.length === 0) {
      missingItems.push(slot.draft.item_name);
      continue;
    }

    requirementSlots.push({
      requirement: {
        item_name: slot.draft.item_name,
        target_quantity: slot.draft.target_quantity,
        unit: slot.draft.unit,
        minimum_quality: slot.draft.minimum_quality,
        constraints_json: slot.draft.constraints_json,
      },
      pack_candidates: packCandidates,
    });
  }

  if (missingItems.length > 0) {
    const listed = missingItems.join(", ");
    return {
      status: "CLARIFICATION_REQUIRED",
      clarification: {
        question: `We could not find authoritative catalog matches for: ${listed}. Can you specify alternative items or quantities?`,
        reason:
          "No eligible catalog SKUs with stock/pricing were found for one or more extracted requirements.",
      },
    };
  }

  if (requirementSlots.length === 0) {
    return {
      status: "CLARIFICATION_REQUIRED",
      clarification: {
        question:
          "Please list each grocery item with an explicit quantity (e.g. 6 eggs, 500g rice).",
        reason: "No requirements could be matched to the authoritative catalog.",
      },
    };
  }

  return {
    status: "SUCCESS",
    input: {
      requirements: requirementSlots,
      budget_minor: args.budget_minor,
    },
  };
}
