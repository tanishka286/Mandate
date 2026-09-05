import type {
  MaterializeOptimizationBasketsInput,
  SessionBasketsData,
} from "../../../src/modules/basket/schema.js";
import type { OptimizationMaterializer } from "../../../src/modules/agent/materialize-from-optimization.js";

const NOW = "2026-09-05T12:00:00.000Z";
export const STUB_SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
export const STUB_OPT_RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb99";
export const STUB_BV_BASKET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
export const STUB_BQ_BASKET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";

/**
 * In-memory materializer for unit tests (no hosted Supabase).
 * Proves orchestration calls BasketService port without DB tools.
 */
export function createStubMaterializer(
  options: {
    fail?: boolean;
    onCall?: (
      userId: string,
      input: MaterializeOptimizationBasketsInput,
    ) => void;
  } = {},
): OptimizationMaterializer {
  return {
    async materializeOptimizationBaskets(userId, rawInput) {
      const input = rawInput as MaterializeOptimizationBasketsInput;
      options.onCall?.(userId, input);
      if (options.fail) {
        throw new Error("stub materialization failure");
      }

      const baseBasket = (
        type: "BEST_VALUE" | "BEST_QUALITY",
        basketId: string,
        combinationKey: string | null,
      ) => ({
        basket_id: basketId,
        optimization_run_id: STUB_OPT_RUN_ID,
        session_id: input.session_id,
        user_id: userId,
        basket_type: type,
        status: "CURRENT" as const,
        gross_amount_minor: 0,
        discount_amount_minor: 0,
        final_payable_minor: 0,
        currency: "INR" as const,
        quality_summary: null,
        recommendation_reason: null,
        explanation: null,
        combination_key: combinationKey,
        state_version: 1,
        items: [],
        created_at: NOW,
        updated_at: NOW,
      });

      const best_value = input.best_value
        ? baseBasket(
            "BEST_VALUE",
            STUB_BV_BASKET_ID,
            input.best_value.combination_key ?? "bv-key",
          )
        : null;
      const best_quality = input.best_quality
        ? baseBasket(
            "BEST_QUALITY",
            STUB_BQ_BASKET_ID,
            input.best_quality.combination_key ?? "bq-key",
          )
        : null;

      const recommendedType =
        input.recommendation?.recommended_basket_type ?? null;
      let recommendedBasketId: string | null = null;
      if (recommendedType === "BEST_VALUE" && best_value) {
        recommendedBasketId = best_value.basket_id;
      } else if (recommendedType === "BEST_QUALITY" && best_quality) {
        recommendedBasketId = best_quality.basket_id;
      }

      const result: SessionBasketsData = {
        session_id: input.session_id,
        optimization_run_id: STUB_OPT_RUN_ID,
        best_value,
        best_quality,
        recommendation: {
          recommended_basket_type: recommendedType,
          recommended_basket_id: recommendedBasketId,
          reason: input.recommendation?.reason ?? null,
          tradeoff_summary: input.recommendation?.tradeoff_summary ?? null,
          user_may_select_alternative: true,
        },
        active_selection: null,
      };
      return result;
    },
  };
}
