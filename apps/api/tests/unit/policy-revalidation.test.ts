import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyService } from "../../src/modules/policy/service.js";
import { PolicyRevalidationService } from "../../src/modules/policy/revalidation-service.js";
import {
  POLICY_REASON_CODES,
  POLICY_VERSION,
  policyRevalidationRequestSchema,
} from "../../src/modules/policy/schema.js";
import type { PolicyRepository } from "../../src/modules/policy/repository.js";
import type {
  AuthoritativeSkuSnapshot,
  IncentivePort,
  PolicyCatalogPort,
} from "../../src/modules/policy/ports.js";
import type { QuoteResolutionPort } from "../../src/modules/policy/quote-adapter.js";
import { UnavailableQuoteAdapter } from "../../src/modules/policy/quote-adapter.js";
import type { MandateService } from "../../src/modules/mandate/service.js";
import type { MandateWithCategories } from "../../src/modules/mandate/schema.js";
import type { PolicyDecisionRow } from "../../src/modules/policy/types.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { buildPolicyRequestFingerprint } from "../../src/modules/policy/fingerprint.js";

const ownerId = "44444444-4444-4444-8444-444444444401";
const mandateId = "77777777-7777-4777-8777-777777777701";
const basketId = "99999999-9999-4999-8999-999999999901";
const skuDairy = "33333333-3333-4333-8333-333333333301";
const quoteVersion = "quote-v1";
const priorIdemKey = "idem-prior-allow";
const revalidateIdemKey = "idem-revalidate-001";

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

function revalidationRequest(overrides: Record<string, unknown> = {}) {
  return {
    user_id: ownerId,
    mandate_id: mandateId,
    basket_id: basketId,
    request_id: "req-revalidate-001",
    idempotency_key: revalidateIdemKey,
    quote_version: quoteVersion,
    ...overrides,
  };
}

function createHarness(options: {
  mandate?: MandateWithCategories;
  mandateError?: AppError;
  snapshots?: AuthoritativeSkuSnapshot[];
  incentivePort?: IncentivePort;
  quote?: QuoteResolutionPort;
  /** Seed a prior ALLOW under a different idempotency key. */
  seedPriorAllow?: boolean;
}) {
  const inserted: PolicyDecisionRow[] = [];
  const byUserKey = new Map<string, PolicyDecisionRow>();
  let decisionSeq = 0;

  const seedFp = buildPolicyRequestFingerprint({
    mandate_id: mandateId,
    basket_id: basketId,
    quote_version: quoteVersion,
  });

  if (options.seedPriorAllow) {
    const prior: PolicyDecisionRow = {
      policy_decision_id: "88888888-8888-4888-8888-888888888800",
      user_id: ownerId,
      mandate_id: mandateId,
      basket_id: basketId,
      decision: "ALLOW",
      reason_code: null,
      gross_amount_minor: 2400,
      discount_amount_minor: 0,
      final_payable_minor: 2400,
      max_spend_minor: 100000,
      policy_version: POLICY_VERSION,
      evaluated_at: "2026-09-01T00:00:00.000Z",
      request_id: "req-prior-allow",
      idempotency_key: priorIdemKey,
      request_fingerprint: seedFp,
      created_at: "2026-09-01T00:00:00.000Z",
    };
    byUserKey.set(`${ownerId}:${priorIdemKey}`, prior);
  }

  const repository = {
    insertDecision: async (input: Record<string, unknown>) => {
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
    findBasketSessionId: async () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
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
    loadSkuSnapshots: async () => options.snapshots ?? [dairySku],
  };

  const incentives =
    options.incentivePort ??
    ({
      evaluate: async ({ claimed_incentive_ids }) =>
        claimed_incentive_ids.length === 0
          ? { ok: true, discount_amount_minor: 0 }
          : { ok: false, reason_code: "INCENTIVE_INVALID" as const },
    } satisfies IncentivePort);

  const policyService = new PolicyService(
    repository,
    mandateService,
    catalog,
    incentives,
  );

  const quotes: QuoteResolutionPort =
    options.quote ??
    ({
      resolve: async () => ({
        lines: [{ sku_id: skuDairy, quantity: 2 }],
        claimed_incentive_ids: [],
      }),
    } satisfies QuoteResolutionPort);

  const evaluateSpy = vi.spyOn(policyService, "evaluate");

  const revalidation = new PolicyRevalidationService(policyService, quotes);

  return {
    revalidation,
    policyService,
    evaluateSpy,
    inserted,
    byUserKey,
  };
}

describe("PolicyRevalidationService", () => {
  it("DENY MANDATE_INVALID when prior ALLOW exists but current mandate is invalid", async () => {
    const { revalidation, inserted } = createHarness({
      seedPriorAllow: true,
      mandateError: new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "Mandate is not active for authorization",
        statusCode: 422,
        details: { status: "REVOKED" },
      }),
    });

    const result = await revalidation.revalidate(revalidationRequest(), now);

    expect(result).toMatchObject({
      decision: "DENY",
      reason_code: "MANDATE_INVALID",
      recoverable: false,
    });
    expect(inserted.some((r) => r.decision === "ALLOW")).toBe(false);
    expect(inserted[0]?.idempotency_key).toBe(revalidateIdemKey);
  });

  it("DENY STOCK_UNAVAILABLE when prior ALLOW exists but current stock is unavailable", async () => {
    const { revalidation } = createHarness({
      seedPriorAllow: true,
      snapshots: [{ ...dairySku, available_quantity: 0 }],
    });

    const result = await revalidation.revalidate(revalidationRequest(), now);
    expect(result.reason_code).toBe("STOCK_UNAVAILABLE");
    expect(result.decision).toBe("DENY");
  });

  it("DENY MAX_SPEND_EXCEEDED when prior ALLOW quote becomes more expensive", async () => {
    const { revalidation } = createHarness({
      seedPriorAllow: true,
      mandate: { ...activeMandate, max_spend_minor: 5000 },
      snapshots: [{ ...dairySku, price_minor: 4000, available_quantity: 10 }],
    });

    const result = await revalidation.revalidate(revalidationRequest(), now);
    expect(result).toMatchObject({
      decision: "DENY",
      reason_code: "MAX_SPEND_EXCEEDED",
      final_payable_minor: 8000,
      max_spend_minor: 5000,
    });
  });

  it("DENY INCENTIVE_INVALID when previously valid incentive becomes invalid", async () => {
    const { revalidation } = createHarness({
      seedPriorAllow: true,
      quote: {
        resolve: async () => ({
          lines: [{ sku_id: skuDairy, quantity: 2 }],
          claimed_incentive_ids: ["voucher-stale"],
        }),
      },
      incentivePort: {
        evaluate: async () => ({
          ok: false,
          reason_code: "INCENTIVE_INVALID",
        }),
      },
    });

    const result = await revalidation.revalidate(revalidationRequest(), now);
    expect(result.reason_code).toBe("INCENTIVE_INVALID");
  });

  it("fail-closed AMOUNT_CALCULATION_FAILED when authoritative quote is unavailable", async () => {
    const { revalidation, evaluateSpy } = createHarness({
      seedPriorAllow: true,
      quote: new UnavailableQuoteAdapter(),
    });

    await expect(
      revalidation.revalidate(revalidationRequest(), now),
    ).rejects.toMatchObject({
      code: "AMOUNT_CALCULATION_FAILED",
      statusCode: 422,
      details: expect.objectContaining({ recoverable: false }),
    });
    expect(evaluateSpy).not.toHaveBeenCalled();
  });

  it("ALLOW only when current authoritative state independently passes all checks", async () => {
    const { revalidation, inserted } = createHarness({
      seedPriorAllow: true,
    });

    const result = await revalidation.revalidate(revalidationRequest(), now);
    expect(result.decision).toBe("ALLOW");
    expect(result.reason_code).toBeNull();
    expect(result.final_payable_minor).toBe(2400);
    expect(result.policy_decision_id).not.toBe(
      "88888888-8888-4888-8888-888888888800",
    );
    expect(inserted).toHaveLength(1);
  });

  it("never treats a previous ALLOW as sufficient authorization by itself", async () => {
    const { revalidation, evaluateSpy, byUserKey } = createHarness({
      seedPriorAllow: true,
      mandateError: new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "expired",
        statusCode: 422,
      }),
    });

    expect(byUserKey.get(`${ownerId}:${priorIdemKey}`)?.decision).toBe("ALLOW");

    const result = await revalidation.revalidate(revalidationRequest(), now);
    expect(result.decision).toBe("DENY");
    expect(result.reason_code).toBe("MANDATE_INVALID");
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects stale client-provided final_payable on the revalidation schema", () => {
    expect(() =>
      policyRevalidationRequestSchema.parse({
        ...revalidationRequest(),
        final_payable_minor: 1,
      }),
    ).toThrow();
  });

  it("rejects stale client-provided price on the revalidation schema", () => {
    expect(() =>
      policyRevalidationRequestSchema.parse({
        ...revalidationRequest(),
        price_minor: 1,
      }),
    ).toThrow();
  });

  it("rejects client lines, stock, category, and decision fields", () => {
    for (const extra of [
      { lines: [{ sku_id: skuDairy, quantity: 1 }] },
      { available_quantity: 99 },
      { category_code: "dairy" },
      { decision: "ALLOW" },
      { policy_decision_id: "88888888-8888-4888-8888-888888888800" },
      { gross_amount_minor: 1 },
      { discount_amount_minor: 1 },
    ]) {
      expect(() =>
        policyRevalidationRequestSchema.parse({
          ...revalidationRequest(),
          ...extra,
        }),
      ).toThrow();
    }
  });

  it("uses current authoritative catalog price for the fresh decision", async () => {
    const { revalidation } = createHarness({
      seedPriorAllow: true,
      snapshots: [{ ...dairySku, price_minor: 2500, available_quantity: 10 }],
    });

    const result = await revalidation.revalidate(revalidationRequest(), now);
    expect(result.decision).toBe("ALLOW");
    expect(result.final_payable_minor).toBe(5000);
  });

  it("uses current authoritative stock for availability", async () => {
    const { revalidation } = createHarness({
      seedPriorAllow: true,
      snapshots: [{ ...dairySku, available_quantity: 1 }],
    });

    const result = await revalidation.revalidate(revalidationRequest(), now);
    expect(result.reason_code).toBe("STOCK_UNAVAILABLE");
  });

  it("uses current mandate state (max_spend) for spend authorization", async () => {
    const { revalidation } = createHarness({
      seedPriorAllow: true,
      mandate: { ...activeMandate, max_spend_minor: 1000 },
    });

    const result = await revalidation.revalidate(revalidationRequest(), now);
    expect(result.reason_code).toBe("MAX_SPEND_EXCEEDED");
  });

  it("delegates authorization rules to PolicyService.evaluate", async () => {
    const { revalidation, evaluateSpy } = createHarness({});

    await revalidation.revalidate(revalidationRequest(), now);

    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSpy.mock.calls[0]?.[0]).toMatchObject({
      user_id: ownerId,
      mandate_id: mandateId,
      basket_id: basketId,
      idempotency_key: revalidateIdemKey,
      quote_version: quoteVersion,
      lines: [{ sku_id: skuDairy, quantity: 2 }],
      claimed_incentive_ids: [],
    });
  });

  it("does not require a real basket or quote table (in-memory quote port)", async () => {
    const { revalidation } = createHarness({
      quote: {
        resolve: async () => ({
          lines: [{ sku_id: skuDairy, quantity: 1 }],
          claimed_incentive_ids: [],
        }),
      },
    });

    const result = await revalidation.revalidate(revalidationRequest(), now);
    expect(result.decision).toBe("ALLOW");
    expect(result.final_payable_minor).toBe(1200);
  });

  it("does not create payment orders or invoke Razorpay", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "../../src/modules/policy/revalidation-service.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from ["'].*modules\/payments/);
    expect(source).not.toMatch(/from ["'].*modules\/checkout/);
    expect(source).not.toMatch(/createPaymentOrder|createOrder|Razorpay\b/);
    expect(typeof PolicyRevalidationService.prototype.revalidate).toBe(
      "function",
    );
    expect(
      Object.getOwnPropertyNames(PolicyRevalidationService.prototype),
    ).toEqual(expect.arrayContaining(["revalidate"]));
    expect(
      Object.getOwnPropertyNames(PolicyRevalidationService.prototype),
    ).not.toEqual(
      expect.arrayContaining(["createPaymentOrder", "createOrder"]),
    );
  });

  it("preserves Step 5 idempotency replay for the same revalidation key+fingerprint", async () => {
    const { revalidation, inserted } = createHarness({});

    const first = await revalidation.revalidate(revalidationRequest(), now);
    const second = await revalidation.revalidate(
      revalidationRequest({ request_id: "req-revalidate-retry" }),
      now,
    );

    expect(second.policy_decision_id).toBe(first.policy_decision_id);
    expect(second.decision).toBe(first.decision);
    expect(inserted).toHaveLength(1);
  });

  it("idempotency conflict when revalidation reuses a key with a different quote_version", async () => {
    const { revalidation } = createHarness({});

    await revalidation.revalidate(revalidationRequest(), now);

    await expect(
      revalidation.revalidate(
        revalidationRequest({ quote_version: "quote-v2-fresh" }),
        now,
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.IDEMPOTENCY_CONFLICT,
      statusCode: 409,
    });
  });

  it("keeps the locked policy reason-code vocabulary unchanged", () => {
    expect([...POLICY_REASON_CODES]).toEqual([
      "MANDATE_INVALID",
      "CATEGORY_NOT_ALLOWED",
      "STOCK_UNAVAILABLE",
      "MAX_PER_ITEM_EXCEEDED",
      "INCENTIVE_INVALID",
      "AMOUNT_CALCULATION_FAILED",
      "MAX_SPEND_EXCEEDED",
    ]);
  });

  it("default quote adapter fails closed without inventing basket lines", async () => {
    const policyService = {
      evaluate: vi.fn(),
    } as unknown as PolicyService;
    const service = new PolicyRevalidationService(
      policyService,
      new UnavailableQuoteAdapter(),
    );

    await expect(service.revalidate(revalidationRequest(), now)).rejects.toMatchObject({
      code: "AMOUNT_CALCULATION_FAILED",
    });
    expect(policyService.evaluate).not.toHaveBeenCalled();
  });
});
