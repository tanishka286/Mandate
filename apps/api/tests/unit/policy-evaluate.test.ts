import { describe, it, expect } from "vitest";
import { PolicyService } from "../../src/modules/policy/service.js";
import type { PolicyRepository } from "../../src/modules/policy/repository.js";
import type {
  AuthoritativeSkuSnapshot,
  IncentivePort,
  PolicyCatalogPort,
} from "../../src/modules/policy/ports.js";
import type { MandateService } from "../../src/modules/mandate/service.js";
import type { MandateWithCategories } from "../../src/modules/mandate/schema.js";
import type { PolicyDecisionRow } from "../../src/modules/policy/types.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { POLICY_VERSION } from "../../src/modules/policy/reason-codes.js";
import { policyEvaluateRequestSchema } from "../../src/modules/policy/schema.js";
import { buildPolicyRequestFingerprint } from "../../src/modules/policy/fingerprint.js";

const ownerId = "44444444-4444-4444-8444-444444444401";
const otherUserId = "44444444-4444-4444-8444-444444444402";
const mandateId = "77777777-7777-4777-8777-777777777701";
const otherMandateId = "77777777-7777-4777-8777-777777777702";
const basketId = "99999999-9999-4999-8999-999999999901";
const otherBasketId = "99999999-9999-4999-8999-999999999902";
const skuDairy = "33333333-3333-4333-8333-333333333301";
const skuExpensive = "33333333-3333-4333-8333-333333333399";
const quoteVersion = "quote-v1";

const now = new Date("2026-10-01T00:00:00.000Z");

const activeMandate: MandateWithCategories = {
  mandate_id: mandateId,
  user_id: ownerId,
  agent_id: "agent-001",
  max_spend_minor: 100000,
  currency: "INR",
  max_per_item_minor: 30000,
  purpose: "test",
  valid_until: "2026-12-31T23:59:59.000Z",
  status: "ACTIVE",
  allowed_categories: ["dairy"],
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

const dairySku: AuthoritativeSkuSnapshot = {
  sku_id: skuDairy,
  product_id: "22222222-2222-4222-8222-222222222201",
  sku_status: "ACTIVE",
  product_status: "ACTIVE",
  category_code: "dairy",
  price_minor: 1200,
  currency: "INR",
  available_quantity: 48,
};

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    user_id: ownerId,
    mandate_id: mandateId,
    basket_id: basketId,
    request_id: "req-policy-001",
    idempotency_key: "idem-policy-001",
    quote_version: quoteVersion,
    lines: [{ sku_id: skuDairy, quantity: 2 }],
    claimed_incentive_ids: [],
    ...overrides,
  };
}

function createHarness(options: {
  mandate?: MandateWithCategories;
  mandateError?: AppError;
  snapshots?: AuthoritativeSkuSnapshot[];
  catalogError?: boolean;
  incentivePort?: IncentivePort;
  raceOnSecondInsert?: boolean;
}) {
  const inserted: PolicyDecisionRow[] = [];
  const byUserKey = new Map<string, PolicyDecisionRow>();
  let insertCount = 0;
  let decisionSeq = 0;

  const repository = {
    insertDecision: async (input: Record<string, unknown>) => {
      insertCount += 1;
      if (options.raceOnSecondInsert && insertCount === 1) {
        // Simulate concurrent winner already committed.
        const winnerFp = buildPolicyRequestFingerprint({
          mandate_id: String(input.mandate_id),
          basket_id: String(input.basket_id),
          quote_version: quoteVersion,
        });
        const winner: PolicyDecisionRow = {
          policy_decision_id: "88888888-8888-4888-8888-888888888877",
          user_id: String(input.user_id),
          mandate_id: String(input.mandate_id),
          basket_id: String(input.basket_id),
          decision: "ALLOW",
          reason_code: null,
          gross_amount_minor: 2400,
          discount_amount_minor: 0,
          final_payable_minor: 2400,
          max_spend_minor: 100000,
          policy_version: POLICY_VERSION,
          evaluated_at: String(input.evaluated_at),
          request_id: "req-winner",
          idempotency_key: String(input.idempotency_key),
          request_fingerprint: winnerFp,
          created_at: String(input.evaluated_at),
        };
        byUserKey.set(`${winner.user_id}:${winner.idempotency_key}`, winner);
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: "Resource already exists",
          statusCode: 409,
          details: { constraint: "unique" },
        });
      }

      decisionSeq += 1;
      const row: PolicyDecisionRow = {
        policy_decision_id: `88888888-8888-4888-8888-8888888888${String(decisionSeq).padStart(2, "0")}`,
        user_id: String(input.user_id),
        mandate_id: String(input.mandate_id),
        basket_id: String(input.basket_id),
        decision: String(input.decision),
        reason_code: (input.reason_code as string | null) ?? null,
        gross_amount_minor: Number(input.gross_amount_minor),
        discount_amount_minor: Number(input.discount_amount_minor),
        final_payable_minor: Number(input.final_payable_minor),
        max_spend_minor: Number(input.max_spend_minor),
        policy_version: String(input.policy_version),
        evaluated_at: String(input.evaluated_at),
        request_id: String(input.request_id),
        idempotency_key: String(input.idempotency_key),
        request_fingerprint: String(input.request_fingerprint),
        created_at: String(input.evaluated_at),
      };
      const mapKey = `${row.user_id}:${row.idempotency_key}`;
      if (byUserKey.has(mapKey)) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: "Resource already exists",
          statusCode: 409,
          details: { constraint: "unique" },
        });
      }
      byUserKey.set(mapKey, row);
      inserted.push(row);
      return row;
    },
    findById: async () => null,
    findByUserIdempotencyKey: async (userId: string, key: string) =>
      byUserKey.get(`${userId}:${key}`) ?? null,
  } as unknown as PolicyRepository;

  const mandateService = {
    requireValidMandateForAuthorization: async (
      userId: string,
      _mandateId: string,
    ) => {
      if (options.mandateError) {
        throw options.mandateError;
      }
      const mandate = options.mandate ?? activeMandate;
      if (mandate.user_id !== userId) {
        throw new AppError({
          code: ErrorCodes.MANDATE_UNAUTHORIZED,
          message: "Mandate does not belong to the authenticated user",
          statusCode: 403,
        });
      }
      return mandate;
    },
  } as unknown as MandateService;

  const catalog: PolicyCatalogPort = {
    loadSkuSnapshots: async () => {
      if (options.catalogError) {
        throw new Error("catalog unavailable");
      }
      return options.snapshots ?? [dairySku];
    },
  };

  const incentives =
    options.incentivePort ??
    ({
      evaluate: async ({ claimed_incentive_ids }) =>
        claimed_incentive_ids.length === 0
          ? { ok: true, discount_amount_minor: 0 }
          : { ok: false, reason_code: "INCENTIVE_INVALID" as const },
    } satisfies IncentivePort);

  const service = new PolicyService(
    repository,
    mandateService,
    catalog,
    incentives,
  );

  return { service, inserted, byUserKey };
}

describe("PolicyService.evaluate", () => {
  it("returns structured ALLOW for an active valid mandate under limits", async () => {
    const { service, inserted } = createHarness({});
    const result = await service.evaluate(baseRequest(), now);

    expect(result.decision).toBe("ALLOW");
    expect(result.reason_code).toBeNull();
    expect(result.policy_version).toBe(POLICY_VERSION);
    expect(result.final_payable_minor).toBe(2400);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      decision: "ALLOW",
      user_id: ownerId,
      idempotency_key: "idem-policy-001",
      request_fingerprint: buildPolicyRequestFingerprint({
        mandate_id: mandateId,
        basket_id: basketId,
        quote_version: quoteVersion,
      }),
    });
  });

  it("DENY MANDATE_INVALID for an expired mandate", async () => {
    const { service } = createHarness({
      mandateError: new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "Mandate has expired",
        statusCode: 422,
      }),
    });
    const result = await service.evaluate(baseRequest(), now);
    expect(result).toMatchObject({
      decision: "DENY",
      reason_code: "MANDATE_INVALID",
      recoverable: false,
    });
  });

  it("DENY MANDATE_INVALID for a revoked mandate", async () => {
    const { service } = createHarness({
      mandateError: new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "Mandate is not active",
        statusCode: 422,
        details: { status: "REVOKED" },
      }),
    });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.decision).toBe("DENY");
    expect(result.reason_code).toBe("MANDATE_INVALID");
  });

  it("throws MANDATE_INVALID without persisting for unauthorized ownership", async () => {
    const { service, inserted } = createHarness({
      mandateError: new AppError({
        code: ErrorCodes.MANDATE_UNAUTHORIZED,
        message: "Mandate does not belong to the authenticated user",
        statusCode: 403,
      }),
    });
    await expect(
      service.evaluate(baseRequest({ user_id: otherUserId }), now),
    ).rejects.toMatchObject({
      code: "MANDATE_INVALID",
      statusCode: 422,
    });
    expect(inserted).toHaveLength(0);
  });

  it("throws MANDATE_INVALID without persisting when mandate is not found", async () => {
    const { service, inserted } = createHarness({
      mandateError: new AppError({
        code: ErrorCodes.MANDATE_NOT_FOUND,
        message: "Mandate not found",
        statusCode: 404,
      }),
    });
    await expect(service.evaluate(baseRequest(), now)).rejects.toMatchObject({
      code: "MANDATE_INVALID",
      statusCode: 422,
    });
    expect(inserted).toHaveLength(0);
  });

  it("DENY CATEGORY_NOT_ALLOWED for disallowed catalog category", async () => {
    const { service } = createHarness({
      snapshots: [{ ...dairySku, category_code: "household" }],
    });
    const result = await service.evaluate(baseRequest(), now);
    expect(result).toMatchObject({
      decision: "DENY",
      reason_code: "CATEGORY_NOT_ALLOWED",
      recoverable: true,
    });
  });

  it("DENY STOCK_UNAVAILABLE when quantity exceeds stock", async () => {
    const { service } = createHarness({
      snapshots: [{ ...dairySku, available_quantity: 1 }],
    });
    const result = await service.evaluate(
      baseRequest({ lines: [{ sku_id: skuDairy, quantity: 2 }] }),
      now,
    );
    expect(result.reason_code).toBe("STOCK_UNAVAILABLE");
  });

  it("DENY STOCK_UNAVAILABLE when stock row is missing", async () => {
    const { service } = createHarness({
      snapshots: [{ ...dairySku, available_quantity: null }],
    });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.reason_code).toBe("STOCK_UNAVAILABLE");
  });

  it("DENY MAX_PER_ITEM_EXCEEDED when line amount exceeds ceiling", async () => {
    const { service } = createHarness({
      snapshots: [
        {
          ...dairySku,
          sku_id: skuExpensive,
          price_minor: 20000,
          available_quantity: 10,
        },
      ],
    });
    const result = await service.evaluate(
      baseRequest({
        lines: [{ sku_id: skuExpensive, quantity: 2 }],
      }),
      now,
    );
    expect(result.reason_code).toBe("MAX_PER_ITEM_EXCEEDED");
  });

  it("ALLOW when final payable exactly equals max_spend", async () => {
    const mandate = { ...activeMandate, max_spend_minor: 2400 };
    const { service } = createHarness({ mandate });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.decision).toBe("ALLOW");
    expect(result.final_payable_minor).toBe(2400);
  });

  it("DENY MAX_SPEND_EXCEEDED when final payable exceeds max_spend", async () => {
    const mandate = { ...activeMandate, max_spend_minor: 2000 };
    const { service } = createHarness({ mandate });
    const result = await service.evaluate(baseRequest(), now);
    expect(result).toMatchObject({
      decision: "DENY",
      reason_code: "MAX_SPEND_EXCEEDED",
      final_payable_minor: 2400,
      max_spend_minor: 2000,
      recoverable: true,
    });
  });

  it("fail-closed AMOUNT_CALCULATION_FAILED when catalog state is unavailable", async () => {
    const { service } = createHarness({ catalogError: true });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.reason_code).toBe("AMOUNT_CALCULATION_FAILED");
  });

  it("fail-closed AMOUNT_CALCULATION_FAILED when SKU snapshot is missing", async () => {
    const { service } = createHarness({ snapshots: [] });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.reason_code).toBe("AMOUNT_CALCULATION_FAILED");
  });

  it("evaluates incentives before MAX_SPEND (invalid incentive denies first)", async () => {
    const { service } = createHarness({
      mandate: { ...activeMandate, max_spend_minor: 1_000_000 },
      incentivePort: {
        evaluate: async () => ({
          ok: false,
          reason_code: "INCENTIVE_INVALID",
        }),
      },
    });
    const result = await service.evaluate(
      baseRequest({
        claimed_incentive_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03"],
      }),
      now,
    );
    expect(result.reason_code).toBe("INCENTIVE_INVALID");
    expect(result.discount_amount_minor).toBe(0);
  });

  it("DENY INCENTIVE_INVALID for a claimed unknown incentive id", async () => {
    const { service } = createHarness({
      incentivePort: {
        evaluate: async () => ({
          ok: false,
          reason_code: "INCENTIVE_INVALID",
        }),
      },
    });
    const result = await service.evaluate(
      baseRequest({ claimed_incentive_ids: ["unknown-voucher"] }),
      now,
    );
    expect(result.reason_code).toBe("INCENTIVE_INVALID");
  });

  it("applies zero discount when no incentive is claimed", async () => {
    const { service } = createHarness({});
    const result = await service.evaluate(
      baseRequest({ claimed_incentive_ids: [] }),
      now,
    );
    expect(result.decision).toBe("ALLOW");
    expect(result.discount_amount_minor).toBe(0);
  });

  it("forces zero discount when nothing is claimed even if adapter mis-reports savings", async () => {
    const { service } = createHarness({
      incentivePort: {
        evaluate: async () => ({
          ok: true,
          discount_amount_minor: 999,
        }),
      },
    });
    const result = await service.evaluate(
      baseRequest({ claimed_incentive_ids: [] }),
      now,
    );
    expect(result.discount_amount_minor).toBe(0);
  });

  it("rejects manipulated client final_payable on the request schema", () => {
    expect(() =>
      policyEvaluateRequestSchema.parse({
        ...baseRequest(),
        final_payable_minor: 1,
      }),
    ).toThrow();
  });

  it("rejects manipulated client line_amount on line items", () => {
    expect(() =>
      policyEvaluateRequestSchema.parse({
        ...baseRequest(),
        lines: [
          {
            sku_id: skuDairy,
            quantity: 2,
            line_amount_minor: 1,
          },
        ],
      }),
    ).toThrow();
  });

  it("uses authoritative SKU price to determine payable", async () => {
    const { service } = createHarness({
      snapshots: [{ ...dairySku, price_minor: 8500, available_quantity: 10 }],
    });
    const result = await service.evaluate(
      baseRequest({ lines: [{ sku_id: skuDairy, quantity: 2 }] }),
      now,
    );
    expect(result.final_payable_minor).toBe(17000);
  });

  it("uses authoritative stock to determine availability", async () => {
    const { service } = createHarness({
      snapshots: [{ ...dairySku, available_quantity: 0 }],
    });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.reason_code).toBe("STOCK_UNAVAILABLE");
  });

  it("uses authoritative catalog category for category authorization", async () => {
    const { service } = createHarness({
      snapshots: [{ ...dairySku, category_code: "beverages" }],
    });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.reason_code).toBe("CATEGORY_NOT_ALLOWED");
  });

  it("normalizes dairy catalog code under Doc 10 grocery-only mandate", async () => {
    const groceryMandate: MandateWithCategories = {
      ...activeMandate,
      allowed_categories: ["grocery"],
    };
    const { service } = createHarness({
      mandate: groceryMandate,
      snapshots: [dairySku],
    });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.decision).toBe("ALLOW");
  });

  it("denies household catalog code under grocery-only mandate", async () => {
    const groceryMandate: MandateWithCategories = {
      ...activeMandate,
      allowed_categories: ["grocery"],
    };
    const { service } = createHarness({
      mandate: groceryMandate,
      snapshots: [{ ...dairySku, category_code: "household" }],
    });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.reason_code).toBe("CATEGORY_NOT_ALLOWED");
  });

  it("does not trust client-supplied price or category fields", () => {
    expect(() =>
      policyEvaluateRequestSchema.parse({
        ...baseRequest(),
        lines: [{ sku_id: skuDairy, quantity: 2, price_minor: 1 }],
      }),
    ).toThrow();
  });

  it("returns structured DENY with nonempty reason_code and persisted row", async () => {
    const { service, inserted } = createHarness({
      mandateError: new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "expired",
        statusCode: 422,
      }),
    });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.decision).toBe("DENY");
    expect(result.reason_code).toBeTruthy();
    expect(inserted[0]?.reason_code).toBe("MANDATE_INVALID");
    expect(inserted[0]?.user_id).toBe(ownerId);
    expect(inserted[0]?.idempotency_key).toBe("idem-policy-001");
  });
});

describe("PolicyService durable idempotency", () => {
  it("replays the same policy_decision_id for same user+key+fingerprint", async () => {
    const { service, inserted } = createHarness({});
    const first = await service.evaluate(baseRequest(), now);
    const second = await service.evaluate(
      baseRequest({ request_id: "req-retry-002" }),
      now,
    );

    expect(second.policy_decision_id).toBe(first.policy_decision_id);
    expect(second.decision).toBe(first.decision);
    expect(second.final_payable_minor).toBe(first.final_payable_minor);
    expect(inserted).toHaveLength(1);
  });

  it("request_id changes do not affect idempotency identity", async () => {
    const { service, inserted } = createHarness({});
    await service.evaluate(baseRequest({ request_id: "req-a" }), now);
    const replay = await service.evaluate(
      baseRequest({ request_id: "req-b" }),
      now,
    );
    expect(replay.request_id).toBe("req-b");
    expect(inserted).toHaveLength(1);
  });

  it("same key + different mandate → IDEMPOTENCY_CONFLICT", async () => {
    const { service, inserted } = createHarness({});
    await service.evaluate(baseRequest(), now);
    await expect(
      service.evaluate(
        baseRequest({ mandate_id: otherMandateId }),
        now,
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.IDEMPOTENCY_CONFLICT,
      statusCode: 409,
    });
    expect(inserted).toHaveLength(1);
  });

  it("same key + different basket → IDEMPOTENCY_CONFLICT", async () => {
    const { service } = createHarness({});
    await service.evaluate(baseRequest(), now);
    await expect(
      service.evaluate(baseRequest({ basket_id: otherBasketId }), now),
    ).rejects.toMatchObject({
      code: ErrorCodes.IDEMPOTENCY_CONFLICT,
      statusCode: 409,
    });
  });

  it("same key + different quote_version → IDEMPOTENCY_CONFLICT", async () => {
    const { service } = createHarness({});
    await service.evaluate(baseRequest(), now);
    await expect(
      service.evaluate(baseRequest({ quote_version: "quote-v2" }), now),
    ).rejects.toMatchObject({
      code: ErrorCodes.IDEMPOTENCY_CONFLICT,
      statusCode: 409,
    });
  });

  it("different users + same key are independent", async () => {
    const insertedDual: PolicyDecisionRow[] = [];
    const map = new Map<string, PolicyDecisionRow>();
    let seq = 0;
    const repository = {
      insertDecision: async (input: Record<string, unknown>) => {
        seq += 1;
        const row: PolicyDecisionRow = {
          policy_decision_id: `88888888-8888-4888-8888-8888888889${String(seq).padStart(2, "0")}`,
          user_id: String(input.user_id),
          mandate_id: String(input.mandate_id),
          basket_id: String(input.basket_id),
          decision: String(input.decision),
          reason_code: (input.reason_code as string | null) ?? null,
          gross_amount_minor: Number(input.gross_amount_minor),
          discount_amount_minor: Number(input.discount_amount_minor),
          final_payable_minor: Number(input.final_payable_minor),
          max_spend_minor: Number(input.max_spend_minor),
          policy_version: String(input.policy_version),
          evaluated_at: String(input.evaluated_at),
          request_id: String(input.request_id),
          idempotency_key: String(input.idempotency_key),
          request_fingerprint: String(input.request_fingerprint),
          created_at: String(input.evaluated_at),
        };
        map.set(`${row.user_id}:${row.idempotency_key}`, row);
        insertedDual.push(row);
        return row;
      },
      findById: async () => null,
      findByUserIdempotencyKey: async (userId: string, key: string) =>
        map.get(`${userId}:${key}`) ?? null,
    } as unknown as PolicyRepository;

    const mandateService = {
      requireValidMandateForAuthorization: async (
        userId: string,
        mid: string,
      ) => {
        if (userId === ownerId && mid === mandateId) return activeMandate;
        if (userId === otherUserId && mid === otherMandateId) {
          return {
            ...activeMandate,
            mandate_id: otherMandateId,
            user_id: otherUserId,
          };
        }
        throw new AppError({
          code: ErrorCodes.MANDATE_UNAUTHORIZED,
          message: "no",
          statusCode: 403,
        });
      },
    } as unknown as MandateService;

    const dualService = new PolicyService(
      repository,
      mandateService,
      { loadSkuSnapshots: async () => [dairySku] },
      {
        evaluate: async () => ({ ok: true, discount_amount_minor: 0 }),
      },
    );

    const a = await dualService.evaluate(baseRequest(), now);
    const b = await dualService.evaluate(
      baseRequest({
        user_id: otherUserId,
        mandate_id: otherMandateId,
        idempotency_key: "idem-policy-001",
      }),
      now,
    );

    expect(a.policy_decision_id).not.toBe(b.policy_decision_id);
    expect(insertedDual).toHaveLength(2);
  });

  it("resolves unique-constraint races by replaying the winning row", async () => {
    const { service, inserted } = createHarness({ raceOnSecondInsert: true });
    const result = await service.evaluate(baseRequest(), now);
    expect(result.policy_decision_id).toBe(
      "88888888-8888-4888-8888-888888888877",
    );
    expect(result.decision).toBe("ALLOW");
    expect(inserted).toHaveLength(0);
  });

  it("cross-user cannot replay another user's decision via the same key", async () => {
    const { service } = createHarness({});
    await service.evaluate(baseRequest(), now);

    const replay = await service.replayIfPresent({
      user_id: otherUserId,
      idempotency_key: "idem-policy-001",
      mandate_id: mandateId,
      basket_id: basketId,
      quote_version: quoteVersion,
      request_id: "req-other",
    });
    expect(replay).toBeNull();
  });

  it("client user_id cannot affect idempotency scope of another user", async () => {
    const { service, inserted } = createHarness({});
    await service.evaluate(baseRequest(), now);
    // Attacker authenticated as otherUser with same key — independent miss, then unauthorized mandate.
    await expect(
      service.evaluate(
        baseRequest({
          user_id: otherUserId,
          idempotency_key: "idem-policy-001",
        }),
        now,
      ),
    ).rejects.toMatchObject({ code: "MANDATE_INVALID" });
    expect(inserted).toHaveLength(1);
  });
});

describe("buildPolicyRequestFingerprint", () => {
  it("is deterministic and ignores ordering of construction", () => {
    const a = buildPolicyRequestFingerprint({
      mandate_id: mandateId,
      basket_id: basketId,
      quote_version: quoteVersion,
    });
    const b = buildPolicyRequestFingerprint({
      quote_version: quoteVersion,
      basket_id: basketId,
      mandate_id: mandateId,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("PolicyService mutation surface", () => {
  it("does not expose update/delete of historical decisions", () => {
    const proto = PolicyService.prototype as Record<string, unknown>;
    for (const name of [
      "update",
      "updateDecision",
      "delete",
      "overrideDecision",
      "setDecision",
    ]) {
      expect(typeof proto[name]).toBe("undefined");
    }
  });
});
