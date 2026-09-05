import { z } from "zod";
import { parseOrThrow } from "../../../shared/validation/index.js";
import {
  evaluateVoucherDecision,
  evaluateLoyaltyDecision,
  optimizeVoucherDecisions,
  optimizeLoyaltyDecisions,
  type AuthoritativeVoucherInput,
  type AuthoritativeLoyaltyRewardInput,
  type VoucherBasketContextInput,
  type LoyaltyBasketContextInput,
} from "../../optimization/index.js";
import type { AgentToolHandler } from "./registry.js";

/**
 * evaluate_incentives — adapter over Phase 5 voucher/loyalty decision engines.
 *
 * Backend results are authoritative for eligibility and savings.
 * Agent may explain USE_NOW / SAVE_FOR_LATER / DO_NOT_USE but cannot invent them.
 * Never adds products merely to unlock an incentive.
 */

const evaluateIncentivesArgsSchema = z
  .object({
    voucher_basket: z.custom<VoucherBasketContextInput>().optional(),
    loyalty_basket: z.custom<LoyaltyBasketContextInput>().optional(),
    vouchers: z.array(z.custom<AuthoritativeVoucherInput>()).optional(),
    loyalty_rewards: z
      .array(z.custom<AuthoritativeLoyaltyRewardInput>())
      .optional(),
    stacking_authorized: z.boolean().optional(),
  })
  .strict();

/**
 * Isolate voucher metadata free text as untrusted data.
 * Malicious metadata cannot change eligibility (backend decides).
 */
export function isolateVoucherMetadata(meta: unknown): {
  kind: "untrusted_data";
  text: string;
} {
  const text =
    typeof meta === "string"
      ? meta
      : meta == null
        ? ""
        : JSON.stringify(meta);
  return { kind: "untrusted_data", text };
}

export const evaluateIncentivesTool: AgentToolHandler = async (args) => {
  try {
    const parsed = parseOrThrow(evaluateIncentivesArgsSchema, args);
    const vouchers = parsed.vouchers ?? [];
    const loyaltyRewards = parsed.loyalty_rewards ?? [];

    const voucherBundle =
      parsed.voucher_basket && vouchers.length > 0
        ? optimizeVoucherDecisions({
            basket: parsed.voucher_basket,
            vouchers,
            stacking_authorized: parsed.stacking_authorized,
          })
        : {
            selected: null,
            evaluations: [] as ReturnType<typeof evaluateVoucherDecision>[],
            stacking_applied: false as const,
          };

    const loyaltyBundle =
      parsed.loyalty_basket && loyaltyRewards.length > 0
        ? optimizeLoyaltyDecisions({
            basket: parsed.loyalty_basket,
            rewards: loyaltyRewards,
            stacking_authorized: parsed.stacking_authorized,
          })
        : {
            selected: null,
            evaluations: [] as ReturnType<typeof evaluateLoyaltyDecision>[],
            stacking_applied: false as const,
          };

    const voucher_evaluations =
      parsed.voucher_basket == null
        ? []
        : vouchers.map((voucher) => {
            const decision = evaluateVoucherDecision({
              basket: parsed.voucher_basket!,
              voucher,
            });
            const meta = isolateVoucherMetadata(
              "description" in voucher
                ? (voucher as { description?: unknown }).description
                : null,
            );
            return {
              ...decision,
              metadata_untrusted: meta,
            };
          });

    const loyalty_evaluations =
      parsed.loyalty_basket == null
        ? []
        : loyaltyRewards.map((reward) =>
            evaluateLoyaltyDecision({
              basket: parsed.loyalty_basket!,
              reward,
            }),
          );

    return {
      tool: "evaluate_incentives",
      status: "OK",
      data: {
        vouchers: {
          selected: voucherBundle.selected,
          evaluations: voucher_evaluations,
          stacking_applied: voucherBundle.stacking_applied,
        },
        loyalty: {
          selected: loyaltyBundle.selected,
          evaluations: loyalty_evaluations,
          stacking_applied: loyaltyBundle.stacking_applied,
        },
        authority: {
          eligibility_source: "backend_incentive_engine",
          agent_cannot_invent_eligibility: true,
          agent_cannot_add_products_to_unlock: true,
        },
      },
    };
  } catch (error) {
    return {
      tool: "evaluate_incentives",
      status: "ERROR",
      error: {
        code: "INCENTIVE_EVALUATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Incentive evaluation failed",
      },
    };
  }
};
