import { describe, it, expect } from "vitest";
import { IncentivesService } from "../../src/modules/incentives/service.js";
import type { IncentivesRepository } from "../../src/modules/incentives/repository.js";
import type { IncentiveRow } from "../../src/modules/incentives/schema.js";
import { SEED_INCENTIVE_IDS } from "../../src/modules/incentives/seed-fixtures.js";

const now = new Date("2026-10-01T00:00:00.000Z");

function seedRow(
  incentive_id: string,
  type: "VOUCHER" | "LOYALTY_REWARD",
  rules_json: Record<string, unknown>,
  status: "ACTIVE" | "EXPIRED" | "INACTIVE" = "ACTIVE",
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

const FIXTURE_ROWS: IncentiveRow[] = [
  seedRow(SEED_INCENTIVE_IDS.VALID_MEANINGFUL_VOUCHER, "VOUCHER", {
    fixture_code: "VALID_MEANINGFUL_VOUCHER",
    benefit_identity: "seed:voucher:meaningful-50",
    source_reference: "seed:voucher:meaningful-50",
    threshold_minor: 0,
    discount_minor: 5000,
    minimum_spend_minor: 0,
    future_use_value_minor: null,
  }),
  seedRow(SEED_INCENTIVE_IDS.LOW_CURRENT_HIGH_FUTURE_VOUCHER, "VOUCHER", {
    fixture_code: "LOW_CURRENT_HIGH_FUTURE_VOUCHER",
    benefit_identity: "seed:voucher:snack-5pct",
    source_reference: "seed:voucher:snack-5pct",
    threshold_minor: 0,
    discount_minor: 500,
    minimum_spend_minor: 0,
    future_use_value_minor: 5000,
  }),
  seedRow(SEED_INCENTIVE_IDS.EXPIRED_VOUCHER, "VOUCHER", {
    fixture_code: "EXPIRED_VOUCHER",
    benefit_identity: "seed:voucher:expired",
    source_reference: "seed:voucher:expired",
    threshold_minor: 0,
    discount_minor: 2000,
    minimum_spend_minor: 0,
    future_use_value_minor: null,
  }, "EXPIRED"),
  seedRow(SEED_INCENTIVE_IDS.MINIMUM_SPEND_VOUCHER, "VOUCHER", {
    fixture_code: "MINIMUM_SPEND_VOUCHER",
    benefit_identity: "seed:voucher:min-spend-500",
    source_reference: "seed:voucher:min-spend-500",
    threshold_minor: 0,
    discount_minor: 3000,
    minimum_spend_minor: 50000,
    future_use_value_minor: null,
  }),
  seedRow(SEED_INCENTIVE_IDS.USABLE_LOYALTY_REWARD, "LOYALTY_REWARD", {
    fixture_code: "USABLE_LOYALTY_REWARD",
    benefit_identity: "seed:loyalty:usable-100",
    source_reference: "seed:loyalty:usable-100",
    value_kind: "MONETARY",
    redeemable_value_minor: 10000,
    minimum_spend_minor: 0,
    consumable: true,
    future_use_value_minor: null,
  }),
  seedRow(SEED_INCENTIVE_IDS.PRESERVE_LOYALTY_REWARD, "LOYALTY_REWARD", {
    fixture_code: "PRESERVE_LOYALTY_REWARD",
    benefit_identity: "seed:loyalty:preserve",
    source_reference: "seed:loyalty:preserve",
    value_kind: "MONETARY",
    redeemable_value_minor: 500,
    minimum_spend_minor: 0,
    consumable: true,
    future_use_value_minor: 20000,
  }),
];

function serviceWithRows(rows: IncentiveRow[]): IncentivesService {
  const repo = {
    findById: async (id: string) => rows.find((r) => r.incentive_id === id) ?? null,
    findByIds: async (ids: readonly string[]) =>
      rows.filter((r) => ids.includes(r.incentive_id)),
    listActive: async () => rows.filter((r) => r.status === "ACTIVE"),
    createEvaluation: async () => {
      throw new Error("not used");
    },
  } as unknown as IncentivesRepository;
  return new IncentivesService(repo);
}

describe("Phase 10 Step 1 — IncentivesService authoritative fixtures", () => {
  const service = serviceWithRows(FIXTURE_ROWS);
  const grossBasketMinor = 60_000;

  it("meaningful voucher → USE_NOW", () => {
    const row = FIXTURE_ROWS.find(
      (r) => r.incentive_id === SEED_INCENTIVE_IDS.VALID_MEANINGFUL_VOUCHER,
    )!;
    const basket = service.buildVoucherBasketContext(grossBasketMinor);
    const decision = service.evaluateVoucherDecisionForRow(row, basket, now);
    expect(decision.decision).toBe("USE_NOW");
  });

  it("low-current/high-future voucher → SAVE_FOR_LATER", () => {
    const row = FIXTURE_ROWS.find(
      (r) => r.incentive_id === SEED_INCENTIVE_IDS.LOW_CURRENT_HIGH_FUTURE_VOUCHER,
    )!;
    const basket = service.buildVoucherBasketContext(10_000);
    const decision = service.evaluateVoucherDecisionForRow(row, basket, now);
    expect(decision.decision).toBe("SAVE_FOR_LATER");
  });

  it("expired voucher → DO_NOT_USE", () => {
    const row = FIXTURE_ROWS.find(
      (r) => r.incentive_id === SEED_INCENTIVE_IDS.EXPIRED_VOUCHER,
    )!;
    const basket = service.buildVoucherBasketContext(grossBasketMinor);
    const decision = service.evaluateVoucherDecisionForRow(row, basket, now);
    expect(decision.decision).toBe("DO_NOT_USE");
  });

  it("minimum-spend voucher is ineligible below threshold", () => {
    const row = FIXTURE_ROWS.find(
      (r) => r.incentive_id === SEED_INCENTIVE_IDS.MINIMUM_SPEND_VOUCHER,
    )!;
    expect(service.resolveEligibility(row, 30_000, now)).toBe("INELIGIBLE");
    const basket = service.buildVoucherBasketContext(30_000);
    const decision = service.evaluateVoucherDecisionForRow(row, basket, now);
    expect(decision.decision).toBe("DO_NOT_USE");
  });

  it("usable loyalty reward → USE_NOW", () => {
    const row = FIXTURE_ROWS.find(
      (r) => r.incentive_id === SEED_INCENTIVE_IDS.USABLE_LOYALTY_REWARD,
    )!;
    const basket = service.buildLoyaltyBasketContext(grossBasketMinor);
    const decision = service.evaluateLoyaltyDecisionForRow(row, basket, now);
    expect(decision.decision).toBe("USE_NOW");
  });

  it("preserve-loyalty reward → SAVE_FOR_LATER", () => {
    const row = FIXTURE_ROWS.find(
      (r) => r.incentive_id === SEED_INCENTIVE_IDS.PRESERVE_LOYALTY_REWARD,
    )!;
    const basket = service.buildLoyaltyBasketContext(grossBasketMinor);
    const decision = service.evaluateLoyaltyDecisionForRow(row, basket, now);
    expect(decision.decision).toBe("SAVE_FOR_LATER");
  });

  it("evaluateForPolicy rejects SAVE_FOR_LATER claims", async () => {
    const result = await service.evaluateForPolicy(
      {
        claimed_incentive_ids: [SEED_INCENTIVE_IDS.LOW_CURRENT_HIGH_FUTURE_VOUCHER],
        gross_amount_minor: 10_000,
      },
      now,
    );
    expect(result).toEqual({ ok: false, reason_code: "INCENTIVE_INVALID" });
  });

  it("evaluateForPolicy applies authoritative discount for USE_NOW voucher", async () => {
    const result = await service.evaluateForPolicy(
      {
        claimed_incentive_ids: [SEED_INCENTIVE_IDS.VALID_MEANINGFUL_VOUCHER],
        gross_amount_minor: grossBasketMinor,
      },
      now,
    );
    expect(result).toEqual({ ok: true, discount_amount_minor: 5000 });
  });

  it("evaluateForPolicy rejects unknown incentive ids", async () => {
    const result = await service.evaluateForPolicy(
      {
        claimed_incentive_ids: ["00000000-0000-4000-8000-000000000099"],
        gross_amount_minor: grossBasketMinor,
      },
      now,
    );
    expect(result).toEqual({ ok: false, reason_code: "INCENTIVE_INVALID" });
  });
});
