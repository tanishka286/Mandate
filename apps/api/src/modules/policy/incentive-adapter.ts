import { IncentivesService } from "../incentives/service.js";
import type {
  IncentivePort,
  IncentiveEvaluationResult,
  IncentiveEvaluationContext,
} from "./ports.js";

/**
 * Phase 2 Step 4 fail-closed placeholder — retained for tests when persistence
 * must be unavailable.
 */
export class FailClosedIncentiveAdapter implements IncentivePort {
  async evaluate(
    input: IncentiveEvaluationContext,
  ): Promise<IncentiveEvaluationResult> {
    if (input.claimed_incentive_ids.length === 0) {
      return { ok: true, discount_amount_minor: 0 };
    }
    return { ok: false, reason_code: "INCENTIVE_INVALID" };
  }
}

/**
 * Phase 10 Step 1 — authoritative incentive validation for policy (Doc 06 Rule 5).
 *
 * Loads persisted incentive facts and delegates discount computation to
 * IncentivesService. Never invents savings or eligibility.
 */
export class PersistedIncentiveAdapter implements IncentivePort {
  constructor(private readonly incentives = new IncentivesService()) {}

  async evaluate(
    input: IncentiveEvaluationContext,
  ): Promise<IncentiveEvaluationResult> {
    return this.incentives.evaluateForPolicy({
      claimed_incentive_ids: input.claimed_incentive_ids,
      gross_amount_minor: input.gross_amount_minor,
    });
  }
}
