import type { ShoppingIntent } from "../intents/schema.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import type { RequirementExtractor } from "./extractor.js";
import {
  extractionResultSchema,
  type ExtractedRequirementDraft,
  type ExtractionAssumption,
  type ExtractionResult,
} from "./extraction-schema.js";

/**
 * Deterministic Phase 3 Step 6 extractor — exit-gate hardening (Doc 10 §5.1).
 * Not an LLM. Confidence is rule certainty only (not authorization/stock/payment).
 *
 * Confidence convention:
 * - 1.0  explicit quantity+unit matched verbatim (e.g. "6 eggs", "2 packs pasta")
 * - 0.94 documented MVP culinary approximation (e.g. "pasta for 4" → 2 packs)
 *
 * Does NOT invent: products, SKUs, prices, stock, payment, or arbitrary quantities.
 */
export class DeterministicRequirementExtractor implements RequirementExtractor {
  extract(intent: ShoppingIntent): ExtractionResult {
    const goal = intent.goal_text.trim();
    const assumptions: ExtractionAssumption[] = [];
    const globalConstraints = collectGlobalConstraints(goal);

    const minimumQuality = mapQualityPreference(
      intent.quality_preference,
      assumptions,
    );

    // Incomplete known items without quantity → clarify (never invent quantity).
    const incomplete = findIncompleteItemMentions(goal);
    if (incomplete.length > 0) {
      return clarification(
        assumptions,
        incompleteClarification(incomplete),
      );
    }

    if (isMateriallyAmbiguous(goal)) {
      return clarification(assumptions, {
        question:
          "What grocery items or meal ingredients should we shop for?",
        reason:
          "The goal is too ambiguous to extract safe ingredient quantities without inventing requirements.",
      });
    }

    if (containsUnsafePriceOrStockLanguage(goal)) {
      assumptions.push({
        code: "NON_AUTHORITATIVE_ADJECTIVES_IGNORED",
        message:
          "Words like cheap/available are not treated as price or stock authority; only explicit grocery needs are extracted.",
        source: "Phase 3 Step 6 hardening",
      });
    }

    const drafts: ExtractedRequirementDraft[] = [];

    const eggs = matchEggsWithOptionalBrand(goal);
    if (eggs) {
      drafts.push({
        item_name: "eggs",
        target_quantity: eggs.quantity,
        unit: "pieces",
        minimum_quality: minimumQuality,
        constraints_json: mergeConstraints(
          eggs.brand ? [{ type: "brand", value: eggs.brand }] : [],
          globalConstraints,
        ),
        // Explicit count → full rule certainty (not LLM probability).
        confidence: 1,
      });
    }

    const pastaPacks = matchExplicitPastaPacks(goal);
    if (pastaPacks) {
      drafts.push({
        item_name: "pasta",
        target_quantity: pastaPacks.packs,
        unit: "packs",
        minimum_quality: minimumQuality,
        constraints_json: mergeConstraints([], globalConstraints),
        confidence: 1,
      });
    }

    const pastaServings = matchPastaForServings(goal);
    // Prefer explicit pack quantity when both patterns somehow appear.
    if (pastaServings && !pastaPacks) {
      drafts.push({
        item_name: "pasta",
        target_quantity: pastaServings.packs,
        unit: "packs",
        minimum_quality: minimumQuality,
        constraints_json: mergeConstraints([], globalConstraints),
        confidence: 0.94,
      });
      assumptions.push({
        code: "PASTA_SERVING_PACK_BASIS",
        message: pastaServings.assumptionMessage,
        detail: "0.5 pack per serving",
        source: "MVP deterministic planning rule (Doc 08 / Doc 10)",
      });
    }

    // Budget is planning input on the intent — never a requirement row.
    // Do not parse/overwrite intent.budget_minor here.
    if (mentionsBudget(goal) && drafts.length > 0) {
      assumptions.push({
        code: "BUDGET_ON_INTENT",
        message:
          "Stated budget remains on shopping_intent.budget_minor; no budget requirement created.",
        source: "Doc 07 / Doc 08 planning vs authorization split",
      });
    }

    if (drafts.length === 0) {
      return clarification(assumptions, {
        question:
          "Please specify the grocery items and quantities you need (e.g. 6 eggs, 2 packs pasta, pasta for 4).",
        reason:
          "No supported deterministic extraction rule matched the goal text without inventing requirements.",
      });
    }

    // Multi-item safety: if the goal mentions additional grocery tokens we did
    // not fully resolve, clarify rather than return a partial invention.
    if (hasUnresolvedSiblingItems(goal, drafts)) {
      return clarification(assumptions, {
        question:
          "Please list each grocery item with an explicit quantity (e.g. 6 eggs and 2 packs pasta).",
        reason:
          "The goal appears to mention multiple items, but not all could be extracted safely without inventing quantities.",
      });
    }

    return parseOrThrow(extractionResultSchema, {
      status: "SUCCESS",
      requirements: drafts,
      assumptions,
    });
  }
}

type ConstraintEntry =
  | { type: "brand"; value: string }
  | { type: "category"; value: string }
  | { type: "exclusion"; value: string };

function clarification(
  assumptions: ExtractionAssumption[],
  clarification: { question: string; reason: string },
): ExtractionResult {
  return parseOrThrow(extractionResultSchema, {
    status: "CLARIFICATION_REQUIRED",
    requirements: [],
    assumptions,
    clarification,
  });
}

function incompleteClarification(items: string[]): {
  question: string;
  reason: string;
} {
  const listed = items.join(", ");
  return {
    question: `What quantity of ${listed} do you need?`,
    reason: `Item(s) mentioned (${listed}) without an explicit quantity; inventing a default quantity is not allowed.`,
  };
}

/**
 * Item mentioned without an explicit quantity — never invent a default.
 * "eggs" / "pasta" alone → incomplete. "6 eggs" / "pasta for 4" → complete.
 */
function findIncompleteItemMentions(goal: string): string[] {
  const incomplete: string[] = [];

  if (/\beggs?\b/i.test(goal) && !matchEggsWithOptionalBrand(goal)) {
    incomplete.push("eggs");
  }

  const hasPasta = /\bpasta\b/i.test(goal);
  const pastaResolved =
    matchExplicitPastaPacks(goal) !== null ||
    matchPastaForServings(goal) !== null;
  if (hasPasta && !pastaResolved) {
    incomplete.push("pasta");
  }

  return incomplete;
}

function matchEggsWithOptionalBrand(
  goal: string,
): { quantity: number; brand: string | null } | null {
  // "6 Farm Fresh eggs" — Title-Case brand words between count and eggs.
  const branded = goal.match(
    /\b(\d+(?:\.\d+)?)\s+((?:[A-Z][A-Za-z0-9&'-]*)(?:\s+[A-Z][A-Za-z0-9&'-]*)+)\s+eggs?\b/,
  );
  if (branded) {
    const quantity = Number(branded[1]);
    if (Number.isFinite(quantity) && quantity > 0) {
      return { quantity, brand: branded[2].trim() };
    }
  }

  // "6 eggs" or "6 cheap available eggs" (lowercase fillers ignored as non-authority).
  const plain = goal.match(
    /\b(\d+(?:\.\d+)?)\s+(?:[a-z][a-z]*(?:\s+[a-z][a-z]*)*\s+)?eggs?\b/i,
  );
  if (!plain) {
    return null;
  }
  const quantity = Number(plain[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const brandFromPhrase = extractBrandConstraint(goal);
  return {
    quantity,
    brand: brandFromPhrase?.value ?? null,
  };
}

/** Explicit "2 packs pasta" / "2 pack of pasta" — no serving assumption. */
function matchExplicitPastaPacks(
  goal: string,
): { packs: number } | null {
  const match = goal.match(
    /\b(\d+(?:\.\d+)?)\s*packs?\s+(?:of\s+)?pasta\b/i,
  );
  if (!match) {
    return null;
  }
  const packs = Number(match[1]);
  if (!Number.isFinite(packs) || packs <= 0) {
    return null;
  }
  return { packs };
}

/**
 * Doc 08 example: "Pasta for 4" → 2 packs.
 * Quantity basis: 0.5 pack per serving (MVP culinary approximation).
 */
function matchPastaForServings(
  goal: string,
): { packs: number; assumptionMessage: string } | null {
  const match = goal.match(/\bpasta\s+for\s+(\d+)\b/i);
  if (!match) {
    return null;
  }
  const servings = Number(match[1]);
  if (!Number.isInteger(servings) || servings <= 0) {
    return null;
  }
  const packs = servings / 2;
  return {
    packs,
    assumptionMessage: `Assumed 0.5 pack of pasta per serving (${packs} packs for ${servings} people) because the user did not specify pack quantity.`,
  };
}

function extractBrandConstraint(
  goal: string,
): { type: "brand"; value: string } | null {
  const match = goal.match(/\bbrand\s+([^,.;]+)/i);
  if (!match) {
    return null;
  }
  const value = match[1].trim();
  if (!value) {
    return null;
  }
  return { type: "brand", value };
}

function collectGlobalConstraints(goal: string): ConstraintEntry[] {
  const constraints: ConstraintEntry[] = [];

  // Explicit "brand X" applies to extracted grocery requirements (not product selection).
  const brand = extractBrandConstraint(goal);
  if (brand) {
    constraints.push(brand);
  }

  const category = goal.match(/\bcategory\s+([a-zA-Z][\w-]*)/i);
  if (category) {
    constraints.push({ type: "category", value: category[1].trim() });
  }

  const exclusion = goal.match(/\b(?:exclude|excluding)\s+([^,.;]+)/i);
  if (exclusion) {
    const value = exclusion[1].trim();
    if (value) {
      constraints.push({ type: "exclusion", value });
    }
  }

  return constraints;
}

function mergeConstraints(
  primary: ConstraintEntry[],
  global: ConstraintEntry[],
): ConstraintEntry[] {
  const merged = [...primary];
  for (const entry of global) {
    const duplicate = merged.some(
      (existing) =>
        existing.type === entry.type &&
        existing.value.toLowerCase() === entry.value.toLowerCase(),
    );
    if (!duplicate) {
      merged.push(entry);
    }
  }
  // Attach brand from "brand X" when eggs used plain match without Title-Case brand.
  return merged;
}

function mentionsBudget(goal: string): boolean {
  return /\bbudget\b|₹|rs\.?\b|inr\b/i.test(goal);
}

/** Adjectives that must never become price/stock authority. */
function containsUnsafePriceOrStockLanguage(goal: string): boolean {
  return /\b(cheap|cheapest|affordable|available|in\s+stock)\b/i.test(goal);
}

function isMateriallyAmbiguous(goal: string): boolean {
  const normalized = goal
    .replace(/\bbudget\b[^,]*/gi, " ")
    .replace(/₹\s*\d[\d,]*/g, " ")
    .replace(/\b\d+\s*(rs|inr|paise)\b/gi, " ")
    .replace(/[,.;]/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return true;
  }

  const ambiguousPatterns = [
    /^something\b/,
    /^anything\b/,
    /^food\b/,
    /^groceries\b/,
    /^dinner\b/,
    /^lunch\b/,
    /^breakfast\b/,
    /for\s+dinner$/,
    /for\s+lunch$/,
    /for\s+breakfast$/,
  ];

  return ambiguousPatterns.some((pattern) => pattern.test(normalized));
}

/**
 * Detect leftover grocery tokens that were not covered by extracted drafts.
 * Prevents SUCCESS with only a subset of a multi-item goal.
 */
function hasUnresolvedSiblingItems(
  goal: string,
  drafts: ExtractedRequirementDraft[],
): boolean {
  const extracted = new Set(drafts.map((d) => d.item_name.toLowerCase()));
  const known = ["eggs", "egg", "pasta"] as const;
  for (const token of known) {
    const canonical = token === "egg" ? "eggs" : token;
    if (new RegExp(`\\b${token}\\b`, "i").test(goal) && !extracted.has(canonical)) {
      return true;
    }
  }
  return false;
}

function mapQualityPreference(
  preference: string | null,
  assumptions: ExtractionAssumption[],
): string | null {
  if (preference === null) {
    return null;
  }
  const normalized = preference.trim().toLowerCase();
  // Only map the locked Doc 08 label; do not invent other quality levels.
  if (normalized === "acceptable") {
    return "acceptable";
  }
  assumptions.push({
    code: "QUALITY_PREFERENCE_UNMAPPED",
    message: `Intent quality_preference "${preference}" preserved as an assumption; not mapped to a fabricated minimum_quality level.`,
    source: "Phase 3 quality boundary (no scoring/evidence in this phase)",
  });
  return null;
}
