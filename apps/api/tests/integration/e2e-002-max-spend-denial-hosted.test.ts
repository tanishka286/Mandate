/**
 * E2E-002 — Hosted MAX_SPEND denial + recovery (Phase 10 Step 8).
 *
 * Authoritative chain on hosted Supabase (ccrlaeiwxeyqmakttrsw):
 * over-limit basket → fresh quote → policy DENY (MAX_SPEND_EXCEEDED)
 * → no Razorpay order → user recovery selection → new quote → policy ALLOW
 * → checkout Razorpay Test Mode order only after ALLOW.
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
import { buildSixEggsOptimizationInput } from "../../src/modules/optimization/demo-scenarios.js";
import {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";
import { createApp } from "../../src/app.js";

const HOSTED_REF = "ccrlaeiwxeyqmakttrsw";
const USER_A = "44444444-4444-4444-8444-444444444401";
const MANDATE_B = "77777777-7777-4777-8777-777777777702";
/** ₹40 ceiling — between Best Value (₹36) and Best Quality (₹42) for six eggs. */
const MAX_SPEND_CEILING = 4000;
const MANDATE_B_RESTORE_MAX_SPEND = 80_000;

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
    throw new Error("JWT_SECRET required for E2E-002 hosted test");
  }
  return jwt.sign({ sub: userId }, secret, { expiresIn: "1h" });
}

async function ensureHostedSeamFixtures(maxSpendMinor: number): Promise<void> {
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
      mandate_id: MANDATE_B,
      user_id: USER_A,
      agent_id: "agent-001",
      max_spend_minor: maxSpendMinor,
      currency: "INR",
      max_per_item_minor: 30000,
      purpose: "Mandate B — E2E-002 MAX_SPEND fixture",
      valid_until: "2026-12-31T23:59:59+00:00",
      status: "ACTIVE",
      created_at: "2026-09-01T00:00:00+00:00",
    },
    { onConflict: "mandate_id" },
  );
  if (mandateErr) throw mandateErr;

  const { error: mcErr } = await db.from("mandate_category").upsert(
    [{ mandate_id: MANDATE_B, category: "grocery" }],
    { onConflict: "mandate_id,category" },
  );
  if (mcErr) throw mcErr;
}

async function countSessionOrders(sessionId: string): Promise<number> {
  const db = getSupabaseClient();
  const { count, error } = await db
    .from("order")
    .select("order_id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) throw error;
  return count ?? 0;
}

async function countSessionPayments(sessionId: string): Promise<number> {
  const db = getSupabaseClient();
  const { data: orders, error: orderErr } = await db
    .from("order")
    .select("order_id")
    .eq("session_id", sessionId);
  if (orderErr) throw orderErr;
  if (!orders?.length) {
    return 0;
  }
  const orderIds = orders.map((row) => row.order_id as string);
  const { count, error } = await db
    .from("payment")
    .select("payment_id", { count: "exact", head: true })
    .in("order_id", orderIds);
  if (error) throw error;
  return count ?? 0;
}

describe.skipIf(!hostedReady)("E2E-002 — Hosted MAX_SPEND denial + recovery", () => {
  let sessionId: string;
  let app: ReturnType<typeof createApp>;
  const runTag = `e2e002-${randomUUID().slice(0, 8)}`;

  const cleanupOrderIds: string[] = [];
  const cleanupPaymentIds: string[] = [];
  const cleanupIdempotencyIds: string[] = [];
  const cleanupPolicyDecisionIds: string[] = [];
  const cleanupSessionIds: string[] = [];

  beforeAll(async () => {
    restoreHostedEnvFromDotenv();
    await ensureHostedSeamFixtures(MAX_SPEND_CEILING);
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

    await ensureHostedSeamFixtures(MANDATE_B_RESTORE_MAX_SPEND);
    resetSupabaseClient();
  });

  it("denies over-limit quote, blocks checkout, recovers via feasible basket, then allows Razorpay order", async () => {
    expect(getEnv().SUPABASE_URL).toContain(HOSTED_REF);

    const db = getSupabaseClient();
    const { data: mandateBefore } = await db
      .from("mandate")
      .select("max_spend_minor")
      .eq("mandate_id", MANDATE_B)
      .single();
    expect(Number(mandateBefore?.max_spend_minor)).toBe(MAX_SPEND_CEILING);

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
        mandate_id: MANDATE_B,
        max_spend_minor: MAX_SPEND_CEILING,
        max_per_item_minor: 30_000,
        allowed_categories: ["grocery"],
        currency: "INR",
      },
      goal: { goal_text: "6 eggs" },
      require_policy_check: false,
      skip_catalog_research: true,
      optimization_input: buildSixEggsOptimizationInput(100_000, {
        selectSixPackQuality: "PREMIUM",
      }),
    });

    expect(plan.outcome).toBe("COMPLETED");
    const bvId = plan.run.persisted_baskets!.best_value!.basket_id;
    const bqId = plan.run.persisted_baskets!.best_quality!.basket_id;
    expect(bvId).not.toBe(bqId);

    const list = await request(app)
      .get(`/api/v1/sessions/${sessionId}/baskets`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`);
    expect(list.status).toBe(200);
    const bestValuePayable = list.body.data.best_value.final_payable_minor as number;
    const bestQualityPayable = list.body.data.best_quality.final_payable_minor as number;
    expect(bestQualityPayable).toBe(SIX_EGG_SCENARIO.goodSixPack.price_minor);
    expect(bestValuePayable).toBe(
      SIX_EGG_SCENARIO.goodTwoPack.price_minor * 3,
    );
    expect(bestValuePayable).toBeLessThanOrEqual(MAX_SPEND_CEILING);
    expect(bestQualityPayable).toBeGreaterThan(MAX_SPEND_CEILING);

    expect(await countSessionOrders(sessionId)).toBe(0);
    expect(await countSessionPayments(sessionId)).toBe(0);

    const overLimitSelect = await request(app)
      .post(`/api/v1/sessions/${sessionId}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .send({ basket_id: bqId, selection_source: "USER" });
    expect(overLimitSelect.status).toBe(201);
    const overLimitSelectionId = overLimitSelect.body.data.selection_id as string;

    const overLimitQuoteRes = await request(app)
      .post(`/api/v1/baskets/${bqId}/quote`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .send({ client_claims: { final_payable_minor: 1 } });
    expect(overLimitQuoteRes.status).toBe(201);
    const overLimitPayable =
      overLimitQuoteRes.body.data.final_payable_minor as number;
    expect(overLimitPayable).toBe(bestQualityPayable);
    expect(overLimitPayable).toBeGreaterThan(1);
    expect(overLimitPayable).toBeGreaterThan(MAX_SPEND_CEILING);
    const overLimitQuoteVersion = overLimitQuoteRes.body.data
      .quote_version as string;

    const denyPolicyRes = await request(app)
      .post("/api/v1/policy/evaluate")
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .set("Idempotency-Key", `${runTag}-policy-deny-${randomUUID()}`)
      .send({
        mandate_id: MANDATE_B,
        basket_id: bqId,
        quote_version: overLimitQuoteVersion,
      });
    expect(denyPolicyRes.status).toBe(422);
    expect(denyPolicyRes.body.error.code).toBe("MAX_SPEND_EXCEEDED");
    expect(denyPolicyRes.body.error.details.recoverable).toBe(true);
    expect(denyPolicyRes.body.error.details.final_payable_minor).toBe(
      overLimitPayable,
    );
    expect(denyPolicyRes.body.error.details.max_spend_minor).toBe(
      MAX_SPEND_CEILING,
    );
    const denyPolicyDecisionId = denyPolicyRes.body.error.details
      .policy_decision_id as string;
    cleanupPolicyDecisionIds.push(denyPolicyDecisionId);

    const { data: denyPolicyRow } = await db
      .from("policy_decision")
      .select("decision, reason_code, final_payable_minor, max_spend_minor")
      .eq("policy_decision_id", denyPolicyDecisionId)
      .single();
    expect(denyPolicyRow?.decision).toBe("DENY");
    expect(denyPolicyRow?.reason_code).toBe("MAX_SPEND_EXCEEDED");

    expect(await countSessionOrders(sessionId)).toBe(0);
    expect(await countSessionPayments(sessionId)).toBe(0);

    const denyCheckoutRes = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .set("Idempotency-Key", `${runTag}-checkout-deny-${randomUUID()}`)
      .send({
        selection_id: overLimitSelectionId,
        policy_decision_id: denyPolicyDecisionId,
      });
    expect(denyCheckoutRes.status).toBe(422);
    expect(denyCheckoutRes.body.error.code).toBe("MAX_SPEND_EXCEEDED");
    expect(await countSessionOrders(sessionId)).toBe(0);
    expect(await countSessionPayments(sessionId)).toBe(0);

    const { data: mandateAfterDeny } = await db
      .from("mandate")
      .select("max_spend_minor")
      .eq("mandate_id", MANDATE_B)
      .single();
    expect(Number(mandateAfterDeny?.max_spend_minor)).toBe(MAX_SPEND_CEILING);
    expect(Number(mandateAfterDeny?.max_spend_minor)).toBe(
      Number(mandateBefore?.max_spend_minor),
    );

    const recoverySelect = await request(app)
      .post(`/api/v1/sessions/${sessionId}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .send({ basket_id: bvId, selection_source: "USER" });
    expect(recoverySelect.status).toBe(201);
    expect(recoverySelect.body.data.basket_id).toBe(bvId);
    expect(recoverySelect.body.data.basket_id).not.toBe(bqId);
    const recoverySelectionId = recoverySelect.body.data.selection_id as string;

    const staleQuotePolicyRes = await request(app)
      .post("/api/v1/policy/evaluate")
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .set("Idempotency-Key", `${runTag}-policy-stale-${randomUUID()}`)
      .send({
        mandate_id: MANDATE_B,
        basket_id: bvId,
        quote_version: overLimitQuoteVersion,
      });
    expect(staleQuotePolicyRes.status).toBe(422);
    expect(staleQuotePolicyRes.body.error.code).toBe("AMOUNT_CALCULATION_FAILED");

    const recoveryQuoteRes = await request(app)
      .post(`/api/v1/baskets/${bvId}/quote`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .send({ client_claims: { final_payable_minor: 1 } });
    expect(recoveryQuoteRes.status).toBe(201);
    const recoveryPayable =
      recoveryQuoteRes.body.data.final_payable_minor as number;
    expect(recoveryPayable).toBe(bestValuePayable);
    expect(recoveryPayable).toBeLessThanOrEqual(MAX_SPEND_CEILING);
    expect(recoveryPayable).toBeGreaterThan(1);
    const recoveryQuoteVersion = recoveryQuoteRes.body.data.quote_version as string;
    expect(recoveryQuoteVersion).not.toBe(overLimitQuoteVersion);

    const allowPolicyRes = await request(app)
      .post("/api/v1/policy/evaluate")
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .set("Idempotency-Key", `${runTag}-policy-allow-${randomUUID()}`)
      .send({
        mandate_id: MANDATE_B,
        basket_id: bvId,
        quote_version: recoveryQuoteVersion,
      });
    expect(allowPolicyRes.status).toBe(200);
    expect(allowPolicyRes.body.data.decision).toBe("ALLOW");
    expect(allowPolicyRes.body.data.final_payable_minor).toBe(recoveryPayable);
    const allowPolicyDecisionId = allowPolicyRes.body.data
      .policy_decision_id as string;
    cleanupPolicyDecisionIds.push(allowPolicyDecisionId);

    const stalePolicyCheckoutRes = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .set("Idempotency-Key", `${runTag}-checkout-stale-policy-${randomUUID()}`)
      .send({
        selection_id: recoverySelectionId,
        policy_decision_id: denyPolicyDecisionId,
      });
    expect(stalePolicyCheckoutRes.status).toBe(400);
    expect(stalePolicyCheckoutRes.body.error.code).toBe("VALIDATION_ERROR");
    expect(await countSessionOrders(sessionId)).toBe(0);

    expect(razorpayReady).toBe(true);

    const checkoutRes = await request(app)
      .post("/api/v1/checkout")
      .set("Authorization", `Bearer ${signToken(USER_A)}`)
      .set("Idempotency-Key", `${runTag}-checkout-allow-${randomUUID()}`)
      .send({
        selection_id: recoverySelectionId,
        policy_decision_id: allowPolicyDecisionId,
      });
    expect(checkoutRes.status).toBe(201);
    expect(checkoutRes.body.data.status).toBe("PAYMENT_PENDING");
    expect(checkoutRes.body.data.amount_minor).toBe(recoveryPayable);
    expect(checkoutRes.body.data.razorpay_order_id).toMatch(/^order_/);

    const orderId = checkoutRes.body.data.order_id as string;
    const razorpayOrderId = checkoutRes.body.data.razorpay_order_id as string;
    cleanupOrderIds.push(orderId);

    const { data: orderRow } = await db
      .from("order")
      .select("status, final_payable_minor, razorpay_order_id, policy_decision_id")
      .eq("order_id", orderId)
      .single();
    expect(orderRow?.status).toBe("PAYMENT_PENDING");
    expect(orderRow?.final_payable_minor).toBe(recoveryPayable);
    expect(orderRow?.policy_decision_id).not.toBe(denyPolicyDecisionId);

    const { data: orderPolicyRow } = await db
      .from("policy_decision")
      .select("decision, reason_code, basket_id, final_payable_minor")
      .eq("policy_decision_id", orderRow?.policy_decision_id)
      .single();
    expect(orderPolicyRow?.decision).toBe("ALLOW");
    expect(orderPolicyRow?.reason_code).toBeNull();
    expect(orderPolicyRow?.basket_id).toBe(bvId);
    expect(orderPolicyRow?.final_payable_minor).toBe(recoveryPayable);
    if (orderRow?.policy_decision_id) {
      cleanupPolicyDecisionIds.push(orderRow.policy_decision_id);
    }

    const env = getEnv();
    const rzp = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
    const providerOrder = await rzp.orders.fetch(razorpayOrderId);
    expect(Number(providerOrder.amount)).toBe(recoveryPayable);

    const { data: paymentRows } = await db
      .from("payment")
      .select("payment_id, status, amount_minor")
      .eq("order_id", orderId);
    expect(paymentRows?.length).toBe(1);
    expect(paymentRows?.[0]?.status).toBe("PAYMENT_PENDING");
    expect(paymentRows?.[0]?.amount_minor).toBe(recoveryPayable);
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

    expect(await countSessionOrders(sessionId)).toBe(1);

    const auditRes = await request(app)
      .get(`/api/v1/sessions/${sessionId}/audit`)
      .set("Authorization", `Bearer ${signToken(USER_A)}`);
    expect(auditRes.status).toBe(200);
    const events = auditRes.body.data.events as Array<{
      event_type: string;
      event_data: Record<string, unknown>;
    }>;
    const eventTypes = events.map((event) => event.event_type);
    expect(eventTypes.filter((type) => type === "BASKET_SELECTED").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(eventTypes.filter((type) => type === "FRESH_QUOTE").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(eventTypes).toContain("POLICY_DENY");
    expect(eventTypes).toContain("POLICY_ALLOW");
    expect(eventTypes).toContain("RAZORPAY_ORDER_CREATED");
    expect(eventTypes).not.toContain("PAYMENT_VERIFIED");

    const denyEvents = events.filter((event) => event.event_type === "POLICY_DENY");
    expect(
      denyEvents.some(
        (event) => event.event_data.reason_code === "MAX_SPEND_EXCEEDED",
      ),
    ).toBe(true);
    expect(
      denyEvents.some(
        (event) =>
          Number(event.event_data.final_payable_minor) > MAX_SPEND_CEILING,
      ),
    ).toBe(true);

    const allowEvents = events.filter((event) => event.event_type === "POLICY_ALLOW");
    expect(
      allowEvents.some(
        (event) =>
          Number(event.event_data.final_payable_minor) <= MAX_SPEND_CEILING,
      ),
    ).toBe(true);
  }, 180_000);
});

describe("E2E-002 hosted gate", () => {
  it("documents hosted + Razorpay prerequisites", () => {
    if (!hostedReady) {
      expect(hostedReady).toBe(false);
      return;
    }
    expect(getEnv().SUPABASE_URL).toContain(HOSTED_REF);
    expect(razorpayReady).toBe(true);
  });
});
