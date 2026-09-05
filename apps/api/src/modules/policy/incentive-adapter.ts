import type { IncentivePort, IncentiveEvaluationResult } from "./ports.js";

/**
 * Phase 2 Step 4 incentive adapter (Doc 06 Rule 5).
 *
 * No persistent incentive domain yet:
 * - no claimed ids → ok with discount 0 (nothing applied)
 * - any claimed/unknown id → fail closed INCENTIVE_INVALID
 *
 * Never treats an unvalidated incentive as valid. Never invents savings.
 */
export class FailClosedIncentiveAdapter implements IncentivePort {
  async evaluate(input: {
    claimed_incentive_ids: readonly string[];
  }): Promise<IncentiveEvaluationResult> {
    if (input.claimed_incentive_ids.length === 0) {
      return { ok: true, discount_amount_minor: 0 };
    }
    // Domain unavailable: every claimed incentive fails closed.
    return { ok: false, reason_code: "INCENTIVE_INVALID" };
  }
}
