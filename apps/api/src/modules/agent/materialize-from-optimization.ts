import { deriveBasketId } from "../optimization/index.js";
import type {
  BestQualityBasket,
  BestValueBasket,
} from "../optimization/index.js";
import type { MaterializeOptimizationBasketsInput } from "../basket/schema.js";
import type { SessionBasketsData } from "../basket/schema.js";
import type { OptimizationToolData } from "./tools/optimization-tool.js";

/**
 * Narrow port for Phase 6 → Phase 7 seam.
 * Orchestration invokes BasketService through this port — never an AI DB tool.
 */
export type OptimizationMaterializer = {
  materializeOptimizationBaskets(
    userId: string,
    input: unknown,
  ): Promise<SessionBasketsData>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuidOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return UUID_RE.test(value) ? value : null;
}

function mapDomainBasket(
  basket: BestValueBasket | BestQualityBasket,
): NonNullable<MaterializeOptimizationBasketsInput["best_value"]> {
  return {
    basket_type: basket.basket_type,
    items: basket.items.map((item) => ({
      sku_id: item.sku_id,
      quantity: item.quantity,
      requirement_id: asUuidOrNull(item.requirement_id),
      unit_price_minor: item.unit_price_minor,
      line_amount_minor: item.line_amount_minor,
      quality_level: item.quality_signal,
      evidence_refs_json: [...item.evidence_refs],
    })),
    // Planning snapshots only — NEVER checkout / policy authority.
    // practical_cost_minor (PRACTICAL_OPTIMIZATION_COST) is intentionally omitted.
    gross_amount_minor: basket.gross_amount_minor,
    discount_amount_minor: basket.discount_amount_minor,
    quality_summary: basket.quality_signal,
    explanation: basket.explanation.reasons.join(", "),
    combination_key: basket.combination_key,
  };
}

/**
 * Map authoritative optimization outputs into BasketService materialization input.
 * Domain IDs (BEST_VALUE:<key>) stay in combination_key / derived source keys;
 * persisted UUIDs are assigned by BasketService / hosted Supabase.
 */
export function buildMaterializeInputFromOptimization(args: {
  session_id: string;
  intent_id?: string | null;
  mandate_id: string;
  optimization: OptimizationToolData;
  agent_run_id?: string | null;
  request_id?: string | null;
}): MaterializeOptimizationBasketsInput {
  const { optimization } = args;
  const bestValue =
    optimization.best_value.feasible === true
      ? mapDomainBasket(optimization.best_value.basket)
      : null;
  const bestQuality =
    optimization.best_quality.feasible === true
      ? mapDomainBasket(optimization.best_quality.basket)
      : null;

  const recommendation =
    optimization.recommendation.feasible === true
      ? {
          recommended_basket_type:
            optimization.recommendation.recommended_basket_type,
          reason: optimization.recommendation.rationale,
          tradeoff_summary:
            optimization.recommendation.tradeoff.cost_delta_minor != null
              ? `quality_cost_delta_minor=${optimization.recommendation.tradeoff.cost_delta_minor}`
              : null,
        }
      : {
          recommended_basket_type: null,
          reason: optimization.recommendation.rationale,
          tradeoff_summary: null,
        };

  return {
    session_id: args.session_id,
    intent_id: args.intent_id ?? null,
    mandate_id: args.mandate_id,
    best_value: bestValue,
    best_quality: bestQuality,
    recommendation,
    incentives: [],
    agent_run_id: args.agent_run_id ?? null,
    request_id: args.request_id ?? null,
  };
}

export function sourceBasketKeyFor(
  basket: BestValueBasket | BestQualityBasket,
): string {
  return deriveBasketId(basket);
}

import type { PersistedOptimizationRef } from "./schema.js";

/**
 * Attach domain source keys to persisted SessionBasketsData for agent consumers.
 */
export function toPersistedOptimizationRef(
  sessionData: SessionBasketsData,
  optimization: OptimizationToolData,
): PersistedOptimizationRef {
  const bvSource =
    optimization.best_value.feasible === true
      ? sourceBasketKeyFor(optimization.best_value.basket)
      : null;
  const bqSource =
    optimization.best_quality.feasible === true
      ? sourceBasketKeyFor(optimization.best_quality.basket)
      : null;

  return {
    optimization_run_id: sessionData.optimization_run_id!,
    session_id: sessionData.session_id,
    best_value: sessionData.best_value
      ? {
          basket_id: sessionData.best_value.basket_id,
          basket_type: "BEST_VALUE",
          source_basket_key:
            bvSource ??
            `BEST_VALUE:${sessionData.best_value.combination_key ?? ""}`,
          combination_key: sessionData.best_value.combination_key,
        }
      : null,
    best_quality: sessionData.best_quality
      ? {
          basket_id: sessionData.best_quality.basket_id,
          basket_type: "BEST_QUALITY",
          source_basket_key:
            bqSource ??
            `BEST_QUALITY:${sessionData.best_quality.combination_key ?? ""}`,
          combination_key: sessionData.best_quality.combination_key,
        }
      : null,
    recommendation: sessionData.recommendation
      ? {
          recommended_basket_type:
            sessionData.recommendation.recommended_basket_type,
          recommended_basket_id:
            sessionData.recommendation.recommended_basket_id,
          user_may_select_alternative: true,
        }
      : null,
  };
}
