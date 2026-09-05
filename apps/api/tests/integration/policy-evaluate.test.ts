import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { POLICY_VERSION } from "../../src/modules/policy/reason-codes.js";

const JWT_SECRET = "test-jwt-secret-for-policy-evaluate-phase2";

const userA = "44444444-4444-4444-8444-444444444401";
const userB = "44444444-4444-4444-8444-444444444402";

const mandateId = "66666666-6666-4666-8666-666666666601";
const basketId = "77777777-7777-4777-8777-777777777701";
const skuId = "33333333-3333-4333-8333-333333333301";
const policyDecisionId = "88888888-8888-4888-8888-888888888801";
const quoteVersion = "quote-v1-abc";
const defaultIdemKey = "idem-policy-evaluate-001";

const { resolveMock, evaluateMock, replayMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  evaluateMock: vi.fn(),
  replayMock: vi.fn(),
}));

vi.mock("../../src/config/supabase.js", () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  }),
  resetSupabaseClient: () => undefined,
  isSupabaseConfigured: () => true,
}));

vi.mock("../../src/modules/policy/quote-adapter.js", () => ({
  UnavailableQuoteAdapter: class {
    resolve = (...args: unknown[]) => resolveMock(...args);
  },
}));

vi.mock("../../src/modules/basket/quote-adapter.js", () => ({
  PersistedQuoteAdapter: class {
    resolve = (...args: unknown[]) => resolveMock(...args);
  },
}));

vi.mock("../../src/modules/policy/service.js", () => ({
  PolicyService: class {
    evaluate = (...args: unknown[]) => evaluateMock(...args);
    replayIfPresent = (...args: unknown[]) => replayMock(...args);
  },
}));

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "1h" });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    mandate_id: mandateId,
    basket_id: basketId,
    quote_version: quoteVersion,
    ...overrides,
  };
}

function allowResult(overrides: Record<string, unknown> = {}) {
  return {
    decision: "ALLOW",
    reason_code: null,
    message: null,
    recoverable: false,
    policy_decision_id: policyDecisionId,
    policy_version: POLICY_VERSION,
    mandate_id: mandateId,
    basket_id: basketId,
    gross_amount_minor: 2400,
    discount_amount_minor: 0,
    final_payable_minor: 2400,
    max_spend_minor: 50000,
    evaluated_at: "2026-09-05T00:00:00.000Z",
    request_id: "req-test",
    ...overrides,
  };
}

function denyResult(reason: string, overrides: Record<string, unknown> = {}) {
  return {
    decision: "DENY",
    reason_code: reason,
    message: "Policy denied",
    recoverable: false,
    policy_decision_id: policyDecisionId,
    policy_version: POLICY_VERSION,
    mandate_id: mandateId,
    basket_id: basketId,
    gross_amount_minor: 0,
    discount_amount_minor: 0,
    final_payable_minor: 0,
    max_spend_minor: 50000,
    evaluated_at: "2026-09-05T00:00:00.000Z",
    request_id: "req-test",
    ...overrides,
  };
}

async function loadApp() {
  const { loadEnv } = await import("../../src/config/env.js");
  loadEnv({
    NODE_ENV: "test",
    JWT_SECRET,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  });
  const { createApp } = await import("../../src/app.js");
  return createApp();
}

function evaluateRequest(
  app: Express,
  opts: {
    userId?: string;
    idempotencyKey?: string | null;
    requestId?: string;
    body?: Record<string, unknown>;
  } = {},
) {
  const userId = opts.userId ?? userA;
  let req = request(app)
    .post("/api/v1/policy/evaluate")
    .set("Authorization", `Bearer ${signToken(userId)}`);

  if (opts.idempotencyKey !== null) {
    req = req.set("Idempotency-Key", opts.idempotencyKey ?? defaultIdemKey);
  }
  if (opts.requestId) {
    req = req.set("X-Request-ID", opts.requestId);
  }
  return req.send(opts.body ?? validBody());
}

describe("POST /api/v1/policy/evaluate", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.JWT_SECRET = JWT_SECRET;
    resolveMock.mockReset();
    evaluateMock.mockReset();
    replayMock.mockReset();
    replayMock.mockResolvedValue(null);
    resolveMock.mockResolvedValue({
      lines: [{ sku_id: skuId, quantity: 2 }],
      claimed_incentive_ids: [],
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("1. returns ALLOW for a valid authenticated evaluation", async () => {
    evaluateMock.mockResolvedValue(allowResult({ request_id: "inbound-req-1" }));
    const app = await loadApp();

    const res = await evaluateRequest(app, {
      requestId: "inbound-req-1",
      idempotencyKey: "idem-allow-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.decision).toBe("ALLOW");
    expect(evaluateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userA,
        idempotency_key: "idem-allow-001",
        quote_version: quoteVersion,
      }),
    );
  });

  it("2. rejects missing authentication", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post("/api/v1/policy/evaluate")
      .set("Idempotency-Key", defaultIdemKey)
      .send(validBody());

    expect(res.status).toBe(401);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it("rejects missing Idempotency-Key with IDEMPOTENCY_REQUIRED", async () => {
    const app = await loadApp();
    const res = await evaluateRequest(app, { idempotencyKey: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.IDEMPOTENCY_REQUIRED);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it("rejects blank Idempotency-Key with IDEMPOTENCY_REQUIRED", async () => {
    const app = await loadApp();
    const res = await evaluateRequest(app, { idempotencyKey: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.IDEMPOTENCY_REQUIRED);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it("accepts a valid Idempotency-Key", async () => {
    evaluateMock.mockResolvedValue(allowResult());
    const app = await loadApp();
    const res = await evaluateRequest(app, {
      idempotencyKey: "idem-accepted-xyz",
    });
    expect(res.status).toBe(200);
    expect(evaluateMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: "idem-accepted-xyz" }),
    );
  });

  it("replays via replayIfPresent without calling evaluate", async () => {
    replayMock.mockResolvedValue(allowResult());
    const app = await loadApp();

    const res = await evaluateRequest(app, {
      idempotencyKey: "idem-replay",
      requestId: "req-retry",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.policy_decision_id).toBe(policyDecisionId);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
    expect(replayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userA,
        idempotency_key: "idem-replay",
      }),
    );
  });

  it("returns 409 IDEMPOTENCY_CONFLICT from replayIfPresent", async () => {
    const { AppError } = await import("../../src/shared/errors/index.js");
    replayMock.mockRejectedValue(
      new AppError({
        code: ErrorCodes.IDEMPOTENCY_CONFLICT,
        message: "Idempotency-Key was reused with a different authorization request.",
        statusCode: 409,
      }),
    );
    const app = await loadApp();
    const res = await evaluateRequest(app, {
      body: validBody({ basket_id: "77777777-7777-4777-8777-777777777799" }),
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ErrorCodes.IDEMPOTENCY_CONFLICT);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it("6. cross-user mandate access returns DENY without ownership leak", async () => {
    const { AppError } = await import("../../src/shared/errors/index.js");
    evaluateMock.mockRejectedValue(
      new AppError({
        code: "MANDATE_INVALID",
        message: "Mandate is missing, inactive, expired, or unauthorized.",
        statusCode: 422,
      }),
    );
    const app = await loadApp();
    const res = await evaluateRequest(app, { userId: userB });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("MANDATE_INVALID");
    expect(res.body.error.message.toLowerCase()).not.toMatch(
      /belong|another user|owner/,
    );
  });

  it("7. returns DENY with structured reason_code", async () => {
    evaluateMock.mockResolvedValue(
      denyResult("MAX_SPEND_EXCEEDED", {
        final_payable_minor: 60000,
        max_spend_minor: 50000,
        recoverable: true,
        message: "Final payable exceeds mandate max spend.",
      }),
    );
    const app = await loadApp();
    const res = await evaluateRequest(app);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("MAX_SPEND_EXCEEDED");
  });

  it("8. ALLOW response includes final_payable_minor", async () => {
    evaluateMock.mockResolvedValue(allowResult({ final_payable_minor: 1999 }));
    const app = await loadApp();
    const res = await evaluateRequest(app);
    expect(res.status).toBe(200);
    expect(res.body.data.final_payable_minor).toBe(1999);
  });

  it("9. rejects client-supplied price", async () => {
    const app = await loadApp();
    const res = await evaluateRequest(app, {
      body: validBody({ price: 99 }),
    });
    expect(res.status).toBe(400);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it("10. rejects client-supplied final_payable", async () => {
    const app = await loadApp();
    const res = await evaluateRequest(app, {
      body: validBody({ final_payable_minor: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it("11. rejects client-supplied decision", async () => {
    const app = await loadApp();
    const res = await evaluateRequest(app, {
      body: validBody({ decision: "ALLOW" }),
    });
    expect(res.status).toBe(400);
  });

  it("12. unexpected failure does not produce ALLOW", async () => {
    evaluateMock.mockRejectedValue(new Error("db down"));
    const app = await loadApp();
    const res = await evaluateRequest(app);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });

  it("13. propagates X-Request-ID", async () => {
    evaluateMock.mockResolvedValue(allowResult());
    const app = await loadApp();
    const res = await evaluateRequest(app, { requestId: "corr-policy-013" });
    expect(res.body.meta.request_id).toBe("corr-policy-013");
    expect(evaluateMock).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: "corr-policy-013" }),
    );
  });

  it("14. response does not leak internal errors", async () => {
    evaluateMock.mockRejectedValue(new Error("FATAL: password authentication failed"));
    const app = await loadApp();
    const res = await evaluateRequest(app);
    expect(res.body.error.message).toBe("An unexpected error occurred");
    expect(JSON.stringify(res.body)).not.toMatch(/password|FATAL/i);
  });

  it("rejects client-supplied user_id as body field", async () => {
    const app = await loadApp();
    const res = await evaluateRequest(app, {
      body: validBody({ user_id: userB }),
    });
    expect(res.status).toBe(400);
  });

  it("quote unavailable -> AMOUNT_CALCULATION_FAILED", async () => {
    resolveMock.mockResolvedValue(null);
    const app = await loadApp();
    const res = await evaluateRequest(app);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("AMOUNT_CALCULATION_FAILED");
  });

  it("malformed mandate_id rejected", async () => {
    const app = await loadApp();
    const res = await evaluateRequest(app, {
      body: validBody({ mandate_id: "bad" }),
    });
    expect(res.status).toBe(400);
  });

  it("malformed basket_id rejected", async () => {
    const app = await loadApp();
    const res = await evaluateRequest(app, {
      body: validBody({ basket_id: "bad" }),
    });
    expect(res.status).toBe(400);
  });

  it("missing quote_version rejected", async () => {
    const app = await loadApp();
    const res = await evaluateRequest(app, {
      body: { mandate_id: mandateId, basket_id: basketId },
    });
    expect(res.status).toBe(400);
  });
});
