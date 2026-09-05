import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadEnv, getEnv, isSupabaseConfigured } from "../../src/config/env.js";
import { getSupabaseClient, resetSupabaseClient } from "../../src/config/supabase.js";
import { PaymentsRepository } from "../../src/modules/payments/repository.js";
import { buildCheckoutFingerprint } from "../../src/modules/payments/fingerprint.js";
import { AppError } from "../../src/shared/errors/index.js";

const HOSTED_REF = "ccrlaeiwxeyqmakttrsw";
const USER_A = "44444444-4444-4444-8444-444444444401";
const MANDATE_A = "77777777-7777-4777-8777-777777777701";

function restoreHostedEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      loadDotenv({ path: p, override: true, quiet: true });
      break;
    }
  }
  loadEnv({
    NODE_ENV: "test",
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
  });
  resetSupabaseClient();
}

restoreHostedEnv();

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

describe("Hosted Supabase: Phase 8 Step 6 Atomic Payment Verification (verify_payment_persistence_atomic)", () => {
  const isTarget = isHostedTarget();
  let repo: PaymentsRepository;

  const cleanupSessionIds: string[] = [];
  const cleanupRunIds: string[] = [];
  const cleanupBasketIds: string[] = [];
  const cleanupPolicyDecisionIds: string[] = [];
  const cleanupOrderIds: string[] = [];
  const cleanupPaymentIds: string[] = [];
  const cleanupIdempotencyIds: string[] = [];

  beforeAll(() => {
    if (!isTarget) {
      console.warn("Skipping hosted payment verification test: not connected to hosted Supabase");
      return;
    }
    repo = new PaymentsRepository();
  });

  afterAll(async () => {
    if (!isTarget) return;
    const db = getSupabaseClient();

    for (const id of cleanupIdempotencyIds) {
      await db.from("checkout_idempotency").delete().eq("idempotency_id", id);
    }
    for (const id of cleanupPaymentIds) {
      await db.from("payment").delete().eq("payment_id", id);
    }
    for (const id of cleanupOrderIds) {
      await db.from("order").delete().eq("order_id", id);
    }
    for (const id of cleanupPolicyDecisionIds) {
      await db.from("policy_decision").delete().eq("policy_decision_id", id);
    }
    for (const id of cleanupBasketIds) {
      await db.from("basket").delete().eq("basket_id", id);
    }
    for (const id of cleanupRunIds) {
      await db.from("optimization_run").delete().eq("optimization_run_id", id);
    }
    for (const id of cleanupSessionIds) {
      await db.from("shopping_session").delete().eq("session_id", id);
    }
  });

  async function createOrderFixtures(): Promise<{
    orderId: string;
    paymentId: string;
    razorpayOrderId: string;
  }> {
    const db = getSupabaseClient();
    const sessionId = randomUUID();
    const runId = randomUUID();
    const basketId = randomUUID();
    const policyDecisionId = randomUUID();

    // 1. Session
    const { error: sessionErr } = await db.from("shopping_session").insert({
      session_id: sessionId,
      user_id: USER_A,
      status: "ACTIVE",
    });
    if (sessionErr) throw sessionErr;
    cleanupSessionIds.push(sessionId);

    // 2. Optimization run
    const { error: runErr } = await db.from("optimization_run").insert({
      optimization_run_id: runId,
      session_id: sessionId,
      status: "COMPLETED",
      candidate_count: 1,
    });
    if (runErr) throw runErr;
    cleanupRunIds.push(runId);

    // 3. Basket
    const { error: basketErr } = await db.from("basket").insert({
      basket_id: basketId,
      optimization_run_id: runId,
      session_id: sessionId,
      user_id: USER_A,
      basket_type: "BEST_VALUE",
      status: "CURRENT",
      gross_amount_minor: 6000,
      discount_amount_minor: 1000,
      final_payable_minor: 5000,
      currency: "INR",
      state_version: 1,
    });
    if (basketErr) throw basketErr;
    cleanupBasketIds.push(basketId);

    // 4. Policy decision (ALLOW)
    const { error: policyErr } = await db.from("policy_decision").insert({
      policy_decision_id: policyDecisionId,
      user_id: USER_A,
      mandate_id: MANDATE_A,
      basket_id: basketId,
      decision: "ALLOW",
      gross_amount_minor: 6000,
      discount_amount_minor: 1000,
      final_payable_minor: 5000,
      max_spend_minor: 10000,
      policy_version: "v1.0",
      evaluated_at: new Date().toISOString(),
      request_id: `req-${randomUUID()}`,
    });
    if (policyErr) throw policyErr;
    cleanupPolicyDecisionIds.push(policyDecisionId);

    // 5. Atomic checkout persistence
    const orderId = randomUUID();
    const rzpOrderId = `order_rzp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const idempotencyKey = `idem-verify-${randomUUID()}`;
    const fingerprint = buildCheckoutFingerprint({
      selection_id: randomUUID(),
      policy_decision_id: policyDecisionId,
      quote_version: "qv-verify-1",
      final_payable_minor: 5000,
    });

    const checkoutResult = await repo.createCheckoutPersistenceAtomic({
      order_id: orderId,
      user_id: USER_A,
      session_id: sessionId,
      mandate_id: MANDATE_A,
      basket_id: basketId,
      policy_decision_id: policyDecisionId,
      gross_amount_minor: 6000,
      discount_amount_minor: 1000,
      final_payable_minor: 5000,
      payment_amount_minor: 5000,
      idempotency_key: idempotencyKey,
      request_fingerprint: fingerprint,
      response_json: { test: "verify_init", order_id: orderId },
      razorpay_order_id: rzpOrderId,
    });

    cleanupOrderIds.push(checkoutResult.order.order_id);
    cleanupPaymentIds.push(checkoutResult.payment.payment_id);
    cleanupIdempotencyIds.push(checkoutResult.idempotency.idempotency_id);

    return {
      orderId: checkoutResult.order.order_id,
      paymentId: checkoutResult.payment.payment_id,
      razorpayOrderId: rzpOrderId,
    };
  }

  it("1. atomically transitions payment to VERIFIED and order to PAYMENT_VERIFIED in one transaction", async () => {
    if (!isTarget) return;

    const { orderId, paymentId } = await createOrderFixtures();
    const rzpPaymentId = `pay_rzp_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const verifiedAt = new Date().toISOString();

    const result = await repo.verifyPaymentPersistenceAtomic({
      order_id: orderId,
      payment_id: paymentId,
      razorpay_payment_id: rzpPaymentId,
      verified_at: verifiedAt,
      method: "upi",
    });

    expect(result.replayed).toBe(false);
    expect(result.payment.status).toBe("VERIFIED");
    expect(result.payment.razorpay_payment_id).toBe(rzpPaymentId);
    expect(result.payment.method).toBe("upi");
    expect(result.order.status).toBe("PAYMENT_VERIFIED");

    // Authoritative direct check in hosted DB
    const db = getSupabaseClient();
    const { data: directPayment } = await db
      .from("payment")
      .select("status, razorpay_payment_id, method")
      .eq("payment_id", paymentId)
      .single();

    expect(directPayment?.status).toBe("VERIFIED");
    expect(directPayment?.razorpay_payment_id).toBe(rzpPaymentId);
    expect(directPayment?.method).toBe("upi");

    const { data: directOrder } = await db
      .from("order")
      .select("status")
      .eq("order_id", orderId)
      .single();

    expect(directOrder?.status).toBe("PAYMENT_VERIFIED");
  });

  it("2. repeated verification with identical provider identifiers is safely idempotent", async () => {
    if (!isTarget) return;

    const { orderId, paymentId } = await createOrderFixtures();
    const rzpPaymentId = `pay_rzp_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const verifiedAt = new Date().toISOString();

    // First verification
    const firstResult = await repo.verifyPaymentPersistenceAtomic({
      order_id: orderId,
      payment_id: paymentId,
      razorpay_payment_id: rzpPaymentId,
      verified_at: verifiedAt,
      method: "card",
    });
    expect(firstResult.replayed).toBe(false);

    // Second verification with identical identifiers
    const secondResult = await repo.verifyPaymentPersistenceAtomic({
      order_id: orderId,
      payment_id: paymentId,
      razorpay_payment_id: rzpPaymentId,
      verified_at: verifiedAt,
      method: "card",
    });

    expect(secondResult.replayed).toBe(true);
    expect(secondResult.payment.status).toBe("VERIFIED");
    expect(secondResult.payment.razorpay_payment_id).toBe(rzpPaymentId);
    expect(secondResult.order.status).toBe("PAYMENT_VERIFIED");
  });

  it("3. repeated verification with conflicting provider identifiers is rejected with 409 CONFLICT", async () => {
    if (!isTarget) return;

    const { orderId, paymentId } = await createOrderFixtures();
    const rzpPaymentIdA = `pay_rzp_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const rzpPaymentIdB = `pay_rzp_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

    await repo.verifyPaymentPersistenceAtomic({
      order_id: orderId,
      payment_id: paymentId,
      razorpay_payment_id: rzpPaymentIdA,
    });

    // Attempt verification with conflicting payment id
    await expect(
      repo.verifyPaymentPersistenceAtomic({
        order_id: orderId,
        payment_id: paymentId,
        razorpay_payment_id: rzpPaymentIdB,
      }),
    ).rejects.toThrowError(AppError);
  });
});
