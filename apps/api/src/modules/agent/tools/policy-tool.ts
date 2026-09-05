import { parseOrThrow } from "../../../shared/validation/index.js";
import {
  policyEvaluateRequestSchema,
  type PolicyEvaluationResult,
} from "../../policy/schema.js";
import {
  agentPolicyViewSchema,
  type AgentPolicyView,
} from "../schema.js";
import type { AgentToolHandler } from "./registry.js";

/**
 * evaluate_policy — controlled adapter around PolicyService.
 *
 * Agent may REQUEST evaluation. Agent cannot decide the result.
 * DENY cannot be transformed into ALLOW via prompting.
 */

const evaluatePolicyArgsSchema = policyEvaluateRequestSchema;

export function toAgentPolicyView(
  result: PolicyEvaluationResult,
): AgentPolicyView {
  if (result.decision === "ALLOW") {
    return parseOrThrow(agentPolicyViewSchema, {
      decision: "ALLOW",
      reason_code: "AUTHORIZED",
      final_payable_minor: result.final_payable_minor,
      policy_version: result.policy_version,
      policy_decision_id: result.policy_decision_id,
    });
  }

  return parseOrThrow(agentPolicyViewSchema, {
    decision: "DENY",
    reason_code: result.reason_code,
    recoverable: result.recoverable,
    details: {
      message: result.message,
      final_payable_minor: result.final_payable_minor,
      max_spend_minor: result.max_spend_minor,
      policy_decision_id: result.policy_decision_id,
      policy_version: result.policy_version,
    },
  });
}

/**
 * Reject any attempt to coerce DENY → ALLOW from untrusted input.
 */
export function refusePolicyOverride(proposed: unknown): never {
  throw new Error(
    `Policy override refused: agent cannot set decision from ${JSON.stringify(proposed)}`,
  );
}

export const evaluatePolicyTool: AgentToolHandler = async (args, context) => {
  try {
    const request = parseOrThrow(evaluatePolicyArgsSchema, args);

    const safeRequest = {
      user_id: request.user_id,
      mandate_id: request.mandate_id,
      basket_id: request.basket_id,
      request_id: request.request_id,
      idempotency_key: request.idempotency_key,
      quote_version: request.quote_version,
      lines: request.lines.map((line) => ({
        sku_id: line.sku_id,
        quantity: line.quantity,
      })),
      claimed_incentive_ids: request.claimed_incentive_ids,
    };

    if (
      "decision" in (args as object) ||
      "final_payable_minor" in (args as object) ||
      "override_deny" in (args as object)
    ) {
      refusePolicyOverride(args);
    }

    const result = await context.policy.evaluate(safeRequest);
    const view = toAgentPolicyView(result);

    return {
      tool: "evaluate_policy",
      status: "OK",
      data: view,
    };
  } catch (error) {
    return {
      tool: "evaluate_policy",
      status: "ERROR",
      error: {
        code: "POLICY_EVALUATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Policy evaluation failed",
      },
    };
  }
};
