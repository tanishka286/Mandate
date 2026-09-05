import { z } from "zod";
import { parseOrThrow } from "../../../shared/validation/index.js";
import {
  generateBestValueBasket,
  generateBestQualityBasket,
  recommendBasket,
  deriveBasketId,
  type BestValueInput,
  type BestValueResult,
  type BestQualityResult,
  type BasketRecommendationResult,
} from "../../optimization/index.js";
import type { AgentToolHandler } from "./registry.js";

/**
 * run_optimization — adapter over existing Phase 5 deterministic functions.
 *
 * Does NOT implement a second optimizer.
 * Does NOT move arithmetic into the LLM.
 * Returns structured authoritative basket/optimization outputs.
 */

const runOptimizationArgsSchema = z
  .object({
    /** Opaque BestValueInput — validated by optimization functions themselves. */
    input: z.custom<BestValueInput>(),
    explicit_preference: z
      .enum(["BEST_VALUE", "BEST_QUALITY", "NONE"])
      .optional(),
  })
  .strict();

export type OptimizationToolData = {
  best_value: BestValueResult;
  best_quality: BestQualityResult;
  recommendation: BasketRecommendationResult;
  best_value_basket_id: string | null;
  best_quality_basket_id: string | null;
};

export function runOptimizationCore(
  input: BestValueInput,
  explicitPreference?: "BEST_VALUE" | "BEST_QUALITY" | "NONE",
): OptimizationToolData {
  const bestValue = generateBestValueBasket(input);
  const bestQuality = generateBestQualityBasket(input);

  const bvBasket =
    bestValue.feasible === true ? bestValue.basket : null;
  const bqBasket =
    bestQuality.feasible === true ? bestQuality.basket : null;

  const recommendation = recommendBasket({
    best_value: bvBasket,
    best_quality: bqBasket,
    explicit_preference: explicitPreference ?? "NONE",
  });

  return {
    best_value: bestValue,
    best_quality: bestQuality,
    recommendation,
    best_value_basket_id: bvBasket ? deriveBasketId(bvBasket) : null,
    best_quality_basket_id: bqBasket ? deriveBasketId(bqBasket) : null,
  };
}

export const runOptimizationTool: AgentToolHandler = async (args) => {
  try {
    const parsed = parseOrThrow(runOptimizationArgsSchema, args);
    const data = runOptimizationCore(
      parsed.input,
      parsed.explicit_preference,
    );
    return {
      tool: "run_optimization",
      status: "OK",
      data,
    };
  } catch (error) {
    return {
      tool: "run_optimization",
      status: "ERROR",
      error: {
        code: "OPTIMIZATION_FAILED",
        message:
          error instanceof Error ? error.message : "Optimization failed",
      },
    };
  }
};
