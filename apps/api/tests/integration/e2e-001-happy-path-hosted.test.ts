/**
 * E2E-001 — Hosted happy path (Phase 10 Step 5).
 *
 * Authoritative chain on hosted Supabase (ccrlaeiwxeyqmakttrsw):
 * goal → requirements → optimization → Best Value/Quality → selection → fresh quote
 * → policy ALLOW → checkout (Razorpay Test Mode order) → audit visibility.
 *
 * Payment capture + server verify/webhook require Razorpay Checkout.js in a browser
 * (see apps/web CheckoutPaymentPanel). Headless automation was investigated in Step 6
 * and remains blocked by Razorpay Checkout v2 UI automation complexity.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import Razorpay from "razorpay";
import {
  loadEnv,
  getEnv,
  isSupabaseConfigured,
  isRazorpayTestConfigured,
} from "../../src/config/env.js";
import { getSupabaseClient, resetSupabaseClient } from "../../src/config/supabase.js";
import { SessionsRepository } from "../../src/modules/sessions/repository.js";
import { AgentService } from "../../src/modules/agent/index.js";
import { DeterministicRequirementExtractor } from "../../src/modules/requirements/deterministic-extractor.js";
import {
  type BestValueInput,
  type OptimizationCandidate,
  type PackCandidateInput,
  type PackQualitySnapshot,
} from "../../src/modules/optimization/index.js";
import {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";
import { createApp } from "../../src/app.js";

const HOSTED_REF = "ccrlaeiwxeyqmakttrsw";
const USER_A = "44444444-4444-4444-8444-444444444401";
const MANDATE_A = "77777777-7777-4777-8777-777777777701";

function restoreHostedEnvFromDotenv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: true, quiet: true });
      break;
    }
  }
  loadEnv({
    NODE_ENV: "test",
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_ENV: "test",
  });
  resetSupabaseClient();
}

restoreHostedEnvFromDotenv();

function isHostedTarget(): boolean {
  const env = getEnv();
  if (!isSupabaseConfigured(env)) {
    return false;
  }
  try {
    const host = new URL(env.SUPABASE_URL).hostname;
    return host.startsWith(`${HOSTED_REF}.`);
  } catch {
    return false;
  }
}

const hostedReady = isHostedTarget();
const razorpayReady = isRazorpayTestConfigured();

function signToken(userId: string): string {
  const secret = getEnv().JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET required for E2E-001 hosted test");
  }
  return jwt.sign({ sub: userId }, secret, { expiresIn: "1h" });
}

function quality(
  signal: PackQualitySnapshot["quality_signal"],
): PackQualitySnapshot {
  return {
    quality_signal: signal,
    confidence: 0.9,
    evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02"],
    evidence_status: signal === null ? "NONE" : "SUFFICIENT",
    meets_minimum_quality:
      signal === null ? false : signal !== "UNACCEPTABLE",
  };
}

function candidate(
  overrides: Partial<OptimizationCandidate> &
    Pick<
      OptimizationCandidate,
      "product_id" | "sku_id" | "product_name" | "sku_code"
    >,
): OptimizationCandidate {
  return {
    brand: null,
    category_code: "dairy",
    product_status: "ACTIVE",
    sku_status: "ACTIVE",
    pack_quantity: 6,
    pack_unit: "pieces",
    price_minor: 3600,
    currency: "INR",
    stock_available: 24,
    ...overrides,
  };
}

function eggsOptimizationInput(): BestValueInput {
  const packs: PackCandidateInput[] = [
    {
      candidate: candidate({
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_id: SEED_SKU_IDS.farmEggs6,
        product_name: "Farm Eggs 6",
        sku_code: SIX_EGG_SCENARIO.poorSixPack.sku_code,
        pack_quantity: 6,
        price_minor: SIX_EGG_SCENARIO.poorSixPack.price_minor,
      }),
      quality: quality("UNACCEPTABLE"),
    },
    {
      candidate: candidate({
        product_id: SEED_PRODUCT_IDS.selectEggs,
        sku_id: SEED_SKU_IDS.selectEggs6,
        product_name: "Select Eggs 6",
        sku_code: SIX_EGG_SCENARIO.goodSixPack.sku_code,
        pack_quantity: 6,
        price_minor: SIX_EGG_SCENARIO.goodSixPack.price_minor,
      }),
      quality: quality("GOOD"),
    },
    {
      candidate: candidate({
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_id: SEED_SKU_IDS.farmEggs2,
        product_name: "Farm Eggs 2",
        sku_code: SIX_EGG_SCENARIO.goodTwoPack.sku_code,
        pack_quantity: 2,
        price_minor: SIX_EGG_SCENARIO.goodTwoPack.price_minor,
      }),
      quality: quality("GOOD"),
    },
  ];

  return {
    requirements: [
      {
        requirement: {
          item_name: "eggs",
          target_quantity: 6,
          unit: "pieces",
          minimum_quality: "ACCEPTABLE",
          constraints_json: [],
        },
        pack_candidates: packs,
      },
    ],
    budget_minor: 100_000,
  };
}

async function ensureHostedSeamFixtures(): Promise<void> {
  const db = getSupabaseClient();

  const { error: catErr } = await db.from("category").upsert(
    [
      {
        category_id: "11111111-1111-4111-8111-111111111101",
        code: "dairy",
        name: "Dairy",
      },
      {
        category_id: "11111111-1111-4111-8111-111111111105",
        code: "grocery",
        name: "Grocery",
      },
    ],
    { onConflict: "category_id" },
  );
  if (catErr) throw catErr;

  const { error: prodErr } = await db.from("product").upsert(
    [
      {
        product_id: SEED_PRODUCT_IDS.farmEggs,
        name: "Farm Eggs",
        description: "Fresh farm eggs",
        category_id: "11111111-1111-4111-8111-111111111101",
        brand: "FarmFresh",
        status: "ACTIVE",
      },
      {
        product_id: SEED_PRODUCT_IDS.selectEggs,
        name: "Select Eggs",
        description: "Higher-grade eggs",
        category_id: "11111111-1111-4111-8111-111111111101",
        brand: "SelectFarm",
        status: "ACTIVE",
      },
    ],
    { onConflict: "product_id" },
  );
  if (prodErr) throw prodErr;

  const { error: skuErr } = await db.from("sku").upsert(
    [
      {
        sku_id: SEED_SKU_IDS.farmEggs2,
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_code: "FARM-EGGS-2",
        pack_quantity: 2,
        pack_unit: "pieces",
        price_minor: 1200,
        currency: "INR",
        status: "ACTIVE",
      },
      {
        sku_id: SEED_SKU_IDS.farmEggs6,
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_code: "FARM-EGGS-6",
        pack_quantity: 6,
        pack_unit: "pieces",
        price_minor: 3600,
        currency: "INR",
        status: "ACTIVE",
      },
      {
        sku_id: SEED_SKU_IDS.selectEggs6,
        product_id: SEED_PRODUCT_IDS.selectEggs,
        sku_code: "SELECT-EGGS-6",
        pack_quantity: 6,
        pack_unit: "pieces",
        price_minor: 4200,
        currency: "INR",
        status: "ACTIVE",
      },
    ],
    { onConflict: "sku_id" },
  );
  if (skuErr) throw skuErr;

  const { error: stockErr } = await db.from("stock").upsert(
    [
      { sku_id: SEED_SKU_IDS.farmEggs2, available_quantity: 48 },
      { sku_id: SEED_SKU_IDS.farmEggs6, available_quantity: 24 },
      { sku_id: SEED_SKU_IDS.selectEggs6, available_quantity: 30 },
    ],
    { onConflict: "sku_id" },
  );
  if (stockErr) throw stockErr;

  const { error: userErr } = await db.from("app_user").upsert(
    [{ user_id: USER_A, display_name: "Demo Shopper", currency: "INR" }],
    { onConflict: "user_id" },
  );
  if (userErr) throw userErr;

  const { error: mandateErr } = await db.from("mandate").upsert(
    {
      mandate_id: MANDATE_A,
      user_id: USER_A,
      agent_id: "agent-001",
      max_spend_minor: 100000,
      currency: "INR",
      max_per_item_minor: 30000,
      purpose: "Mandate A — E2E fixture",
      valid_until: "2026-12-31T23:59:59+00:00",
      status: "ACTIVE",
      created_at: "2026-09-01T00:00:00+00:00",
    },
    { onConflict: "mandate_id" },
  );
  if (mandateErr) throw mandateErr;

  const { error: mcErr } = await db.from("mandate_category").upsert(
    [{ mandate_id: MANDATE_A, category: "grocery" }],
    { onConflict: "mandate_id,category" },
  );
  if (mcErr) throw mcErr;
}

describe.skipIf(!hostedReady)("E2E-001 — Hosted happy path", () => {
  let sessionId: string;
  let app: ReturnType<typeof createApp>;
  const runTag = `e2e001-${randomUUID().slice(0, 8)}`;

  const cleanupOrderIds: string[] = [];
  const cleanupPaymentIds: string[] = [];
  const cleanupIdempotencyIds: string[] = [];
  const cleanupPolicyDecisionIds: string[] = [];
  const cleanupSessionIds: string[] = [];

  beforeAll(async () => {
    restoreHostedEnvFromDotenv();
    await ensureHostedSeamFixtures();
    const sessions = new SessionsRepository();
    const session = await sessions.insert({
      user_id: USER_A,
      status: "ACTIVE",
    });
    sessionId = session.session_id;
    cleanupSessionIds.push(sessionId);
    app = createApp();
  });

  afterAll(async () => {
    if (!hostedReady) {
      return;
    }
    const db = getSupabaseClient();

    if (cleanupPaymentIds.length > 0) {
      await db.from("payment").delete().in("payment_id", cleanupPaymentIds);
    }
    if (cleanupIdempotencyIds.length > 0) {
      await db
        .from("checkout_idempotency")
        .delete()
        .in("idempotency_id", cleanupIdempotencyIds);
    }
    if (cleanupOrderIds.length > 0) {
      await db.from("order").delete().in("order_id", cleanupOrderIds);
    }
    if (cleanupPolicyDecisionIds.length > 0) {
      await db
        .from("policy_decision")
        .delete()
        .in("policy_decision_id", cleanupPolicyDecisionIds);
    }
    for (const sid of cleanupSessionIds) {
      await db.from("audit_event").delete().eq("session_id", sid);
      await db.from("basket_quote").delete().eq("session_id", sid);
      await db.from("basket_selection").delete().eq("session_id", sid);
      await db.from("basket").delete().eq("session_id", sid);
      await db.from("optimization_run").delete().eq("session_id", sid);
      await db.from("shopping_session").delete().eq("session_id", sid);
    }
    resetSupabaseClient();
  });

  it("exercises goal → policy ALLOW → Razorpay order → audit trail", async () => {
    expect(getEnv().SUPABASE_URL).toContain(HOSTED_REF);

    const agent = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      useStubLlm: true,
    });

    const plan = await agent.runPlanning({
      agent_run_id: randomUUID(),
      request_id: `${runTag}-plan`,
      user_id: USER_A,
      session_id: sessionId,
      mandate: {
        mandate_id: MANDATE_A,
        max_spend_minor: 100_000,
        max_per_item_minor: 30_000,
        allowed_categories: ["grocery"],
        currency: "INR",
      },
      goal: { goal_text: "6 eggs" },
      require_policy_check: false,
      skip_catalog_research: true,
      optimization_input: eggsOptimizationInput(),
    });

    expect(plan.outcome).toBe("COMPLETED");
    expect(plan.run.persisted_baskets?.best_value?.basket_id).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(plan.run.persisted_baskets?.best_quality?.basket_id).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(plan.run.policy).toBeNull();

    const bvId = plan.run.persisted_baskets!.best_value!.basket_id;
    const bqId = plan.run.persisted_baskets!.best_quality!.basket_id;
    expect(bvId).not.toBe(bqId);

    const list = await request(app)
      .get(`/api/v1/sessions/${sessionId}/baskets`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`);
    expect(list.status).toBe(200);
    expect(list.body.data.best_value.basket_id).toBe(bvId);
    expect(list.body.data.best_quality.basket_id).toBe(bqId);

    const selectRes = await request(app)
      .post(`/api/v1/sessions/${sessionId}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .send({ basket_id: bvId, selection_source: "USER" });
    expect(selectRes.status).toBe(201);
    expect(selectRes.body.data.order_created).toBe(false);
    expect(selectRes.body.data.payment_created).toBe(false);
    expect(selectRes.body.data.policy_decision).toBeNull();
    const selectionId = selectRes.body.data.selection_id as string;

    const quoteRes = await request(app)
      .post(`/api/v1/baskets/${bvId}/quote`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .send({ client_claims: { final_payable_minor: 1 } });
    expect(quoteRes.status).toBe(201);
    expect(quoteRes.body.data.amount_kind).toBe("AUTHORITATIVE_QUOTE");
    const authoritativePayable = quoteRes.body.data.final_payable_minor as number;
    expect(authoritativePayable).toBeGreaterThan(1);
    expect(quoteRes.body.data.order_created).toBe(false);
    expect(quoteRes.body.data.payment_created).toBe(false);
    const quoteVersion = quoteRes.body.data.quote_version as string;

    const policyRes = await request(app)
      .post("/api/v1/policy/evaluate")
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .set("Idempotency-Key", `${runTag}-policy-${randomUUID()}`)
      .send({
        mandate_id: MANDATE_A,
        basket_id: bvId,
        quote_version: quoteVersion,
      });
    expect(policyRes.status).toBe(200);
    expect(policyRes.body.data.decision).toBe("ALLOW");
    const policyDecisionId = policyRes.body.data.policy_decision_id as string;
    cleanupPolicyDecisionIds.push(policyDecisionId);

    expect(razorpayReady).toBe(true);

    const checkoutIdemKey = `${runTag}-checkout-${randomUUID()}`;
    const checkoutRes = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .set("Idempotency-Key", checkoutIdemKey)
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });
    expect(checkoutRes.status).toBe(201);
    expect(checkoutRes.body.data.status).toBe("PAYMENT_PENDING");
    expect(checkoutRes.body.data.amount_minor).toBe(authoritativePayable);
    expect(checkoutRes.body.data.currency).toBe("INR");
    expect(checkoutRes.body.data.razorpay_order_id).toMatch(/^order_/);

    const orderId = checkoutRes.body.data.order_id as string;
    const razorpayOrderId = checkoutRes.body.data.razorpay_order_id as string;
    cleanupOrderIds.push(orderId);

    const db = getSupabaseClient();
    const { data: orderRow } = await db
      .from("order")
      .select("order_id, status, final_payable_minor, razorpay_order_id, policy_decision_id")
      .eq("order_id", orderId)
      .single();
    expect(orderRow?.status).toBe("PAYMENT_PENDING");
    expect(orderRow?.final_payable_minor).toBe(authoritativePayable);
    expect(orderRow?.razorpay_order_id).toBe(razorpayOrderId);
    if (orderRow?.policy_decision_id) {
      cleanupPolicyDecisionIds.push(orderRow.policy_decision_id);
    }

    const { data: paymentRows } = await db
      .from("payment")
      .select("payment_id, status, amount_minor, razorpay_payment_id")
      .eq("order_id", orderId);
    expect(paymentRows?.length).toBe(1);
    expect(paymentRows?.[0]?.status).toBe("PAYMENT_PENDING");
    expect(paymentRows?.[0]?.amount_minor).toBe(authoritativePayable);
    expect(paymentRows?.[0]?.razorpay_payment_id).toBeNull();
    if (paymentRows?.[0]?.payment_id) {
      cleanupPaymentIds.push(paymentRows[0].payment_id);
    }

    const { data: idemRows } = await db
      .from("checkout_idempotency")
      .select("idempotency_id")
      .eq("order_id", orderId);
    if (idemRows?.[0]?.idempotency_id) {
      cleanupIdempotencyIds.push(idemRows[0].idempotency_id);
    }

    const env = getEnv();
    const rzp = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
    const providerOrder = await rzp.orders.fetch(razorpayOrderId);
    expect(Number(providerOrder.amount)).toBe(authoritativePayable);
    expect(providerOrder.currency).toBe("INR");

    const replayCheckout = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .set("Idempotency-Key", checkoutIdemKey)
      .send({
        selection_id: selectionId,
        policy_decision_id: policyDecisionId,
      });
    expect(replayCheckout.status).toBe(201);
    expect(replayCheckout.body.data.order_id).toBe(orderId);
    expect(replayCheckout.body.data.razorpay_order_id).toBe(razorpayOrderId);
    expect(replayCheckout.body.data.amount_minor).toBe(authoritativePayable);

    const auditRes = await request(app)
      .get(`/api/v1/sessions/${sessionId}/audit`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`);
    expect(auditRes.status).toBe(200);
    const eventTypes = (auditRes.body.data.events as Array<{ event_type: string }>).map(
      (e) => e.event_type,
    );
    expect(eventTypes).toContain("BASKET_SELECTED");
    expect(eventTypes).toContain("FRESH_QUOTE");
    expect(eventTypes).toContain("POLICY_ALLOW");
    expect(eventTypes).toContain("RAZORPAY_ORDER_CREATED");

    const { data: policyRow } = await db
      .from("policy_decision")
      .select("decision, final_payable_minor")
      .eq("policy_decision_id", policyDecisionId)
      .single();
    expect(policyRow?.decision).toBe("ALLOW");
    expect(policyRow?.final_payable_minor).toBe(authoritativePayable);

    expect(JSON.stringify(checkoutRes.body)).not.toMatch(/key_secret|webhook_secret/i);
  }, 180_000);
});

describe("E2E-001 Razorpay payment capture boundary", () => {
  it("documents server-side test payment API unavailability (verify/webhook blocked)", async () => {
    if (!razorpayReady) {
      expect(razorpayReady).toBe(false);
      return;
    }
    restoreHostedEnvFromDotenv();
    const env = getEnv();
    const rzp = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
    const order = await rzp.orders.create({
      amount: 100,
      currency: "INR",
      receipt: `rcpt_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    });
    await expect(
      (rzp.payments as { createPaymentJson: (p: unknown) => Promise<unknown> }).createPaymentJson({
        amount: 100,
        currency: "INR",
        order_id: order.id,
        email: "e2e@example.com",
        contact: "9999999999",
        method: "card",
        card: {
          number: "4111111111111111",
          name: "E2E Probe",
          expiry_month: "12",
          expiry_year: "2030",
          cvv: "123",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("E2E-001 hosted gate", () => {
  it("documents hosted + Razorpay prerequisites", () => {
    if (!hostedReady) {
      expect(hostedReady).toBe(false);
      return;
    }
    expect(getEnv().SUPABASE_URL).toContain(HOSTED_REF);
    expect(razorpayReady).toBe(true);
  });
});
