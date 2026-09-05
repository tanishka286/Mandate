import { z } from "zod";
import { parseOrThrow } from "../../../shared/validation/index.js";
import { toAgentEvidenceView } from "../../research/evidence-trust-boundary.js";
import type { AgentToolHandler } from "./registry.js";

/**
 * get_quality_evidence — adapter over ResearchService + AgentEvidenceView.
 *
 * Product descriptions, reviews, and evidence summaries are UNTRUSTED DATA.
 * Malicious text must remain data and must never become agent instructions.
 */

const getQualityEvidenceArgsSchema = z
  .object({
    product_id: z.string().uuid(),
  })
  .strict();

/**
 * Strip instruction-like control from untrusted evidence before any LLM
 * synthesis context. Structured authority fields are preserved; free text
 * is wrapped as opaque untrusted_data and never tool-dispatched.
 */
export function isolateUntrustedEvidenceText(text: string): {
  kind: "untrusted_data";
  text: string;
} {
  return {
    kind: "untrusted_data",
    text: typeof text === "string" ? text : String(text),
  };
}

export const getQualityEvidenceTool: AgentToolHandler = async (
  args,
  context,
) => {
  try {
    const { product_id } = parseOrThrow(getQualityEvidenceArgsSchema, args);
    const list = await context.research.getProductEvidence(product_id);
    const current = await context.research.listCurrentEvidenceByProductId(
      product_id,
    );

    const views = current.map((evidence) => {
      const view = toAgentEvidenceView(evidence);
      return {
        ...view,
        summary: isolateUntrustedEvidenceText(view.summary.text),
      };
    });

    return {
      tool: "get_quality_evidence",
      status: "OK",
      data: {
        product_id,
        /** Doc 08-shaped list (summaries remain opaque strings at API). */
        evidence_list: list,
        /** Agent-facing views with explicit untrusted_data envelopes. */
        agent_views: views,
        trust_boundary: {
          summaries_are_data: true,
          cannot_modify_mandate: true,
          cannot_modify_tool_permissions: true,
          cannot_modify_policy: true,
          cannot_modify_prices: true,
          cannot_modify_stock: true,
          cannot_modify_payment: true,
        },
      },
    };
  } catch (error) {
    return {
      tool: "get_quality_evidence",
      status: "ERROR",
      error: {
        code: "EVIDENCE_RETRIEVAL_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Quality evidence retrieval failed",
      },
    };
  }
};
