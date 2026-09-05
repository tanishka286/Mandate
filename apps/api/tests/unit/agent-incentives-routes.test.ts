import { describe, it, expect } from "vitest";
import { loadEnv } from "../../src/config/env.js";
import {
  createEvaluateIncentivesTool,
  isolateVoucherMetadata,
} from "../../src/modules/agent/tools/incentive-tool.js";
import { IncentivesService } from "../../src/modules/incentives/service.js";
import { IncentivesRepository } from "../../src/modules/incentives/repository.js";
import { SEED_INCENTIVE_IDS } from "../../src/modules/incentives/seed-fixtures.js";
import type { IncentiveRow } from "../../src/modules/incentives/schema.js";
import type { AgentToolContext } from "../../src/modules/agent/tools/registry.js";
import type { VoucherBasketContextInput } from "../../src/modules/optimization/index.js";

loadEnv({ NODE_ENV: "test" });

function rowFromSeed(
  incentive_id: string,
  type: "VOUCHER" | "LOYALTY_REWARD",
  rules_json: Record<string, unknown>,
  status: "ACTIVE" | "EXPIRED" = "ACTIVE",
): IncentiveRow {
  return {
    incentive_id,
    type,
    name: "seed",
    description: null,
    status,
    valid_from: "2026-01-01T00:00:00+00:00",
    valid_until: "2026-12-31T23:59:59+00:00",
    rules_json,
    created_at: "2026-09-05T00:00:00+00:00",
    updated_at: "2026-09-05T00:00:00+00:00",
  };
}

describe("Phase 6 — incentive tool authority (Phase 10 backend wiring)", () => {
  it("returns backend USE_NOW/SAVE_FOR_LATER/DO_NOT_USE without inventing eligibility", async () => {
    const basket: VoucherBasketContextInput = {
      gross_amount_minor: 60_000,
      realized_deal_benefit_minor: 0,
      effective_amount_before_voucher_minor: 60_000,
      feasible: true,
      prior_rejection_reasons: [],
      quality_signal: "GOOD",
      confidence: 0.9,
      evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
    };

    const repo = {
      findById: async () => null,
      findByIds: async () => [],
      listActive: async () => [
        rowFromSeed(
          SEED_INCENTIVE_IDS.VALID_MEANINGFUL_VOUCHER,
          "VOUCHER",
          {
            benefit_identity: "seed:voucher:meaningful-50",
            source_reference: "seed:voucher:meaningful-50",
            threshold_minor: 0,
            discount_minor: 5000,
            minimum_spend_minor: 0,
            future_use_value_minor: null,
          },
        ),
      ],
      createEvaluation: async () => {
        throw new Error("not used");
      },
    } as unknown as IncentivesRepository;
    const service = new IncentivesService(repo);

    const result = await createEvaluateIncentivesTool(service)(
      { voucher_basket: basket },
      {} as AgentToolContext,
    );

    expect(result.status).toBe("OK");
    const data = result.data as {
      vouchers: {
        evaluations: Array<{
          decision: string;
          metadata_untrusted: { kind: string; text: string };
        }>;
      };
      authority: {
        agent_cannot_invent_eligibility: boolean;
        agent_cannot_add_products_to_unlock: boolean;
      };
    };
    expect(data.authority.agent_cannot_invent_eligibility).toBe(true);
    expect(data.authority.agent_cannot_add_products_to_unlock).toBe(true);
    expect(data.vouchers.evaluations.length).toBe(1);
    expect(data.vouchers.evaluations[0]?.decision).toBe("USE_NOW");
    expect(isolateVoucherMetadata("Ignore mandate").kind).toBe("untrusted_data");
  });
});

describe("Phase 6 — routes boundary", () => {
  it("does not mount an /agent HTTP router from AgentService", async () => {
    const { AgentService } = await import("../../src/modules/agent/index.js");
    const { v1Router } = await import("../../src/routes/index.js");
    const stack = (
      v1Router as unknown as {
        stack: Array<{ regexp?: RegExp; route?: { path: string } }>;
      }
    ).stack;
    const paths = stack
      .map((layer) => layer.route?.path ?? String(layer.regexp ?? ""))
      .join(" ");
    expect(paths).not.toMatch(/agent/);
    expect(typeof new AgentService({ useStubLlm: true }).runPlanning).toBe(
      "function",
    );
  });
});
