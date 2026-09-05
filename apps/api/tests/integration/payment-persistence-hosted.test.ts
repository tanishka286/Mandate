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
import { ErrorCodes } from "../../src/shared/constants/index.js";

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

describe("Hosted Supabase: Phase 8 Step 2 Payment Persistence Foundation", () => {
  const isTarget = isHostedTarget();
  let repo: PaymentsRepository;

  // Track created IDs for strict test cleanup
  const cleanupSessionIds: string[] = [];
  const cleanupRunIds: string[] = [];
  const cleanupBasketIds: string[] = [];
  const cleanupPolicyDecisionIds: string[] = [];
  const cleanupOrderIds: string[] = [];
  const cleanupPaymentIds: string[] = [];
  const cleanupWebhookEventIds: string[] = [];
  const cleanupIdempotencyIds: string[] = [];

  beforeAll(async () => {
    if (!isTarget) {
      return;
    }
    repo = new PaymentsRepository();
  });

  afterAll(async () => {
    if (!isTarget) {
      return;
    }
    const db = getSupabaseClient();

    // Clean up in reverse dependency order
    if (cleanupPaymentIds.length > 0) {
      await db.from("payment").delete().in("payment_id", cleanupPaymentIds);
    }
    if (cleanupIdempotencyIds.length > 0) {
      await db.from("checkout_idempotency").delete().in("idempotency_id", cleanupIdempotencyIds);
    }
    if (cleanupOrderIds.length > 0) {
      await db.from("order").delete().in("order_id", cleanupOrderIds);
    }
    if (cleanupPolicyDecisionIds.length > 0) {
      await db.from("policy_decision").delete().in("policy_decision_id", cleanupPolicyDecisionIds);
    }
    if (cleanupBasketIds.length > 0) {
      await db.from("basket").delete().in("basket_id", cleanupBasketIds);
    }
    if (cleanupRunIds.length > 0) {
      await db.from("optimization_run").delete().in("optimization_run_id", cleanupRunIds);
    }
    if (cleanupSessionIds.length > 0) {
      await db.from("shopping_session").delete().in("session_id", cleanupSessionIds);
    }
    if (cleanupWebhookEventIds.length > 0) {
      await db.from("razorpay_webhook_event").delete().in("webhook_event_id", cleanupWebhookEventIds);
    }
  });

  // Helper to create valid session, run, basket, and policy_decision
  async function createAuthorizationFixtures(decision: "ALLOW" | "DENY" = "ALLOW") {
    const db = getSupabaseClient();
    const sessionId = randomUUID();
    const runId = randomUUID();
    const basketId = randomUUID();
    const policyDecisionId = randomUUID();

    // 1. Session
    const { error: sessionError } = await db.from("shopping_session").insert({
      session_id: sessionId,
      user_id: USER_A,
      status: "ACTIVE",
    });
    if (sessionError) throw sessionError;
    cleanupSessionIds.push(sessionId);

    // 2. Optimization run
    const { error: runError } = await db.from("optimization_run").insert({
      optimization_run_id: runId,
      session_id: sessionId,
      status: "COMPLETED",
      candidate_count: 1,
    });
    if (runError) throw runError;
    cleanupRunIds.push(runId);

    // 3. Basket
    const { error: basketError } = await db.from("basket").insert({
      basket_id: basketId,
      optimization_run_id: runId,
      session_id: sessionId,
      user_id: USER_A,
      basket_type: "BEST_VALUE",
      status: "CURRENT",
      gross_amount_minor: 5000,
      discount_amount_minor: 1000,
      final_payable_minor: 4000,
      currency: "INR",
      state_version: 1,
    });
    if (basketError) throw basketError;
    cleanupBasketIds.push(basketId);

    // 4. Policy decision
    const { error: policyError } = await db.from("policy_decision").insert({
      policy_decision_id: policyDecisionId,
      mandate_id: MANDATE_A,
      basket_id: basketId,
      decision,
      reason_code: decision === "DENY" ? "EXCEEDS_BUDGET" : null,
      gross_amount_minor: 5000,
      discount_amount_minor: 1000,
      final_payable_minor: 4000,
      max_spend_minor: 10000,
      policy_version: "v1.0",
      evaluated_at: new Date().toISOString(),
      request_id: `req-${randomUUID()}`,
      user_id: USER_A,
    });
    if (policyError) throw policyError;
    cleanupPolicyDecisionIds.push(policyDecisionId);

    return { sessionId, runId, basketId, policyDecisionId };
  }

  it("proves hosted database connectivity", () => {
    expect(isTarget).toBe(true);
  });

  describe("Order Persistence and Authorization Path Invariants", () => {
    it("successfully creates and retrieves an order referencing an ALLOW decision and matching basket", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");

      const order = await repo.createOrder({
        user_id: USER_A,
        session_id: sessionId,
        mandate_id: MANDATE_A,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        gross_amount_minor: 5000,
        discount_amount_minor: 1000,
        final_payable_minor: 4000,
        status: "CREATED",
      });

      cleanupOrderIds.push(order.order_id);

      expect(order.order_id).toBeDefined();
      expect(order.status).toBe("CREATED");
      expect(order.final_payable_minor).toBe(4000);
      expect(order.gross_amount_minor).toBe(5000);
      expect(order.discount_amount_minor).toBe(1000);
      expect(order.currency).toBe("INR");

      // Verify retrieval by ID
      const loaded = await repo.findOrderById(order.order_id);
      expect(loaded).not.toBeNull();
      expect(loaded?.order_id).toBe(order.order_id);
      expect(loaded?.basket_id).toBe(basketId);
      expect(loaded?.policy_decision_id).toBe(policyDecisionId);

      // Verify update order status
      const updated = await repo.updateOrderStatus(
        order.order_id,
        "PAYMENT_PENDING",
        "order_rzp_123456",
      );
      expect(updated.status).toBe("PAYMENT_PENDING");
      expect(updated.razorpay_order_id).toBe("order_rzp_123456");

      // Verify find by razorpay_order_id
      const byRzp = await repo.findOrderByRazorpayOrderId("order_rzp_123456");
      expect(byRzp?.order_id).toBe(order.order_id);
    });

    it("rejects order creation if policy decision is DENY", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("DENY");

      await expect(
        repo.createOrder({
          user_id: USER_A,
          session_id: sessionId,
          mandate_id: MANDATE_A,
          basket_id: basketId,
          policy_decision_id: policyDecisionId,
          gross_amount_minor: 5000,
          discount_amount_minor: 1000,
          final_payable_minor: 4000,
        }),
      ).rejects.toThrowError(AppError);
    });

    it("rejects order creation if basket_id does not match policy decision basket", async () => {
      const { sessionId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");
      const mismatchedBasketId = randomUUID();

      await expect(
        repo.createOrder({
          user_id: USER_A,
          session_id: sessionId,
          mandate_id: MANDATE_A,
          basket_id: mismatchedBasketId,
          policy_decision_id: policyDecisionId,
          gross_amount_minor: 5000,
          discount_amount_minor: 1000,
          final_payable_minor: 4000,
        }),
      ).rejects.toThrowError();
    });

    it("rejects order creation if policy_decision_id does not exist", async () => {
      const { sessionId, basketId } =
        await createAuthorizationFixtures("ALLOW");
      const nonexistentPolicyId = randomUUID();

      await expect(
        repo.createOrder({
          user_id: USER_A,
          session_id: sessionId,
          mandate_id: MANDATE_A,
          basket_id: basketId,
          policy_decision_id: nonexistentPolicyId,
          gross_amount_minor: 5000,
          discount_amount_minor: 1000,
          final_payable_minor: 4000,
        }),
      ).rejects.toThrowError();
    });
  });

  describe("Payment Persistence and Amount Integrity", () => {
    it("successfully creates a payment matching the order amount and executes state machine transitions", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");

      const order = await repo.createOrder({
        user_id: USER_A,
        session_id: sessionId,
        mandate_id: MANDATE_A,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        gross_amount_minor: 5000,
        discount_amount_minor: 1000,
        final_payable_minor: 4000,
      });
      cleanupOrderIds.push(order.order_id);

      // Create payment with identical amount (4000)
      const payment = await repo.createPayment({
        order_id: order.order_id,
        amount_minor: 4000,
        method: "upi",
        razorpay_payment_id: `pay_${randomUUID().slice(0, 8)}`,
      });
      cleanupPaymentIds.push(payment.payment_id);

      expect(payment.payment_id).toBeDefined();
      expect(payment.order_id).toBe(order.order_id);
      expect(payment.amount_minor).toBe(4000);
      expect(payment.status).toBe("PAYMENT_PENDING");

      // Retrieve by ID
      const loaded = await repo.findPaymentById(payment.payment_id);
      expect(loaded?.payment_id).toBe(payment.payment_id);

      // Retrieve by order ID
      const byOrder = await repo.findPaymentsByOrderId(order.order_id);
      expect(byOrder.length).toBeGreaterThanOrEqual(1);
      expect(byOrder[0].payment_id).toBe(payment.payment_id);

      // Transition PAYMENT_PENDING -> VERIFIED
      const verified = await repo.updatePaymentStatus({
        paymentId: payment.payment_id,
        status: "VERIFIED",
        verifiedAt: new Date().toISOString(),
      });
      expect(verified.status).toBe("VERIFIED");
      expect(verified.verified_at).not.toBeNull();

      // Same-state VERIFIED -> VERIFIED is idempotent no-op
      const verifiedAgain = await repo.updatePaymentStatus({
        paymentId: payment.payment_id,
        status: "VERIFIED",
      });
      expect(verifiedAgain.status).toBe("VERIFIED");

      // Terminal VERIFIED -> FAILED is rejected
      await expect(
        repo.updatePaymentStatus({
          paymentId: payment.payment_id,
          status: "FAILED",
        }),
      ).rejects.toThrowError(AppError);
    });

    it("rejects payment creation if payment amount does not match order final_payable_minor", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");

      const order = await repo.createOrder({
        user_id: USER_A,
        session_id: sessionId,
        mandate_id: MANDATE_A,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        gross_amount_minor: 5000,
        discount_amount_minor: 1000,
        final_payable_minor: 4000,
      });
      cleanupOrderIds.push(order.order_id);

      // Attempt payment with wrong amount (3500 instead of 4000)
      await expect(
        repo.createPayment({
          order_id: order.order_id,
          amount_minor: 3500,
        }),
      ).rejects.toThrowError(AppError);
    });

    it("rejects payment creation for nonexistent order", async () => {
      await expect(
        repo.createPayment({
          order_id: randomUUID(),
          amount_minor: 4000,
        }),
      ).rejects.toThrowError(AppError);
    });
  });

  describe("Checkout Idempotency Persistence", () => {
    it("handles same-key same-request correctly and enforces uniqueness on (user_id, idempotency_key)", async () => {
      const idempotencyKey = `idem-checkout-${randomUUID()}`;
      const fingerprintInput = {
        selection_id: randomUUID(),
        policy_decision_id: randomUUID(),
        quote_version: "v1.0.0",
        final_payable_minor: 4000,
      };
      const fingerprint = buildCheckoutFingerprint(fingerprintInput);

      // First call persists idempotency record
      const record = await repo.createCheckoutIdempotency({
        user_id: USER_A,
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint,
        response_json: { status: "ORDER_CREATED", final_payable_minor: 4000 },
      });
      cleanupIdempotencyIds.push(record.idempotency_id);

      expect(record.idempotency_id).toBeDefined();
      expect(record.user_id).toBe(USER_A);
      expect(record.idempotency_key).toBe(idempotencyKey);
      expect(record.request_fingerprint).toBe(fingerprint);

      // Replay check: find existing record
      const existing = await repo.findCheckoutIdempotency(USER_A, idempotencyKey);
      expect(existing).not.toBeNull();
      expect(existing?.idempotency_id).toBe(record.idempotency_id);

      // Same-key same-request comparison
      const isReplay = existing?.request_fingerprint === fingerprint;
      expect(isReplay).toBe(true);

      // Same-key different-request conflict detection
      const differentFingerprint = buildCheckoutFingerprint({
        ...fingerprintInput,
        final_payable_minor: 4500, // modified amount
      });
      const isConflict = existing?.request_fingerprint !== differentFingerprint;
      expect(isConflict).toBe(true);

      // Unique constraint prevents duplicate insertion
      await expect(
        repo.createCheckoutIdempotency({
          user_id: USER_A,
          idempotency_key: idempotencyKey,
          request_fingerprint: fingerprint,
        }),
      ).rejects.toThrowError(AppError);
    });
  });

  describe("Razorpay Webhook Event Persistence & Deduplication", () => {
    it("persists webhook event and rejects duplicate provider event_id", async () => {
      const eventId = `evt_${randomUUID()}`;
      const eventType = "payment.captured";

      // 1. First receipt persists event
      const event = await repo.createWebhookEvent({
        event_id: eventId,
        event_type: eventType,
        payload_hash: "hash123",
        processing_status: "RECEIVED",
        payload_json: { entity: "event", id: eventId },
      });
      cleanupWebhookEventIds.push(event.webhook_event_id);

      expect(event.webhook_event_id).toBeDefined();
      expect(event.event_id).toBe(eventId);
      expect(event.processing_status).toBe("RECEIVED");

      // Verify retrieval by event_id
      const loaded = await repo.findWebhookEventByEventId(eventId);
      expect(loaded).not.toBeNull();
      expect(loaded?.event_id).toBe(eventId);

      // 2. Duplicate provider event_id MUST be rejected (deduplication invariant)
      await expect(
        repo.createWebhookEvent({
          event_id: eventId,
          event_type: eventType,
          payload_hash: "hash123",
          processing_status: "RECEIVED",
        }),
      ).rejects.toThrowError(AppError);

      // 3. Status update
      const updated = await repo.updateWebhookEventStatus({
        webhookEventId: event.webhook_event_id,
        processingStatus: "PROCESSED",
        processedAt: new Date().toISOString(),
      });
      expect(updated.processing_status).toBe("PROCESSED");
      expect(updated.processed_at).not.toBeNull();
    });
  });

  describe("Phase 8 Step 4A: Atomic Checkout Persistence (create_checkout_persistence_atomic)", () => {
    it("1. successful atomic persistence creates order + payment + idempotency in ONE transaction", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");

      const orderId = randomUUID();
      const idempotencyKey = `idem-atomic-${randomUUID()}`;
      const fingerprint = buildCheckoutFingerprint({
        selection_id: randomUUID(),
        policy_decision_id: policyDecisionId,
        quote_version: "qv-atomic-1",
        final_payable_minor: 4000,
      });

      const result = await repo.createCheckoutPersistenceAtomic({
        order_id: orderId,
        user_id: USER_A,
        session_id: sessionId,
        mandate_id: MANDATE_A,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        gross_amount_minor: 5000,
        discount_amount_minor: 1000,
        final_payable_minor: 4000,
        payment_amount_minor: 4000,
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint,
        response_json: { test: "success", order_id: orderId },
        razorpay_order_id: `order_rzp_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      });

      cleanupOrderIds.push(result.order.order_id);
      cleanupPaymentIds.push(result.payment.payment_id);
      cleanupIdempotencyIds.push(result.idempotency.idempotency_id);

      expect(result.replayed).toBe(false);
      expect(result.order.order_id).toBe(orderId);
      expect(result.order.status).toBe("PAYMENT_PENDING");
      expect(result.order.final_payable_minor).toBe(4000);
      expect(result.payment.order_id).toBe(orderId);
      expect(result.payment.status).toBe("PAYMENT_PENDING");
      expect(result.payment.amount_minor).toBe(4000);
      expect(result.idempotency.order_id).toBe(orderId);
      expect(result.idempotency.idempotency_key).toBe(idempotencyKey);

      // Verify all 3 exist in the REAL hosted database
      const db = getSupabaseClient();
      const { data: dbOrder } = await db.from("order").select("*").eq("order_id", orderId).single();
      const { data: dbPayment } = await db.from("payment").select("*").eq("order_id", orderId).single();
      const { data: dbIdem } = await db.from("checkout_idempotency").select("*").eq("order_id", orderId).single();

      expect(dbOrder).not.toBeNull();
      expect(dbPayment).not.toBeNull();
      expect(dbIdem).not.toBeNull();
    });

    it("2. rolls back entire transaction if payment insertion fails (negative amount)", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");

      const orderId = randomUUID();
      const idempotencyKey = `idem-fail-pay-${randomUUID()}`;
      const fingerprint = "fp-fail-pay";

      await expect(
        repo.createCheckoutPersistenceAtomic({
          order_id: orderId,
          user_id: USER_A,
          session_id: sessionId,
          mandate_id: MANDATE_A,
          basket_id: basketId,
          policy_decision_id: policyDecisionId,
          gross_amount_minor: 5000,
          discount_amount_minor: 1000,
          final_payable_minor: -4000,
          payment_amount_minor: -4000,
          idempotency_key: idempotencyKey,
          request_fingerprint: fingerprint,
          response_json: {},
        }),
      ).rejects.toThrowError(AppError);

      // Verify ATOMIC ROLLBACK in database: order, payment, idempotency must NOT exist
      const db = getSupabaseClient();
      const { data: dbOrder } = await db.from("order").select("*").eq("order_id", orderId).maybeSingle();
      const { data: dbPayment } = await db.from("payment").select("*").eq("order_id", orderId).maybeSingle();
      const { data: dbIdem } = await db.from("checkout_idempotency").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();

      expect(dbOrder).toBeNull();
      expect(dbPayment).toBeNull();
      expect(dbIdem).toBeNull();
    });

    it("3. rolls back entire transaction if idempotency insertion fails (empty key)", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");

      const orderId = randomUUID();
      const emptyKey = "   ";
      const fingerprint = "fp-fail-idem";

      await expect(
        repo.createCheckoutPersistenceAtomic({
          order_id: orderId,
          user_id: USER_A,
          session_id: sessionId,
          mandate_id: MANDATE_A,
          basket_id: basketId,
          policy_decision_id: policyDecisionId,
          gross_amount_minor: 5000,
          discount_amount_minor: 1000,
          final_payable_minor: 4000,
          payment_amount_minor: 4000,
          idempotency_key: emptyKey,
          request_fingerprint: fingerprint,
          response_json: {},
        }),
      ).rejects.toThrowError(AppError);

      // Verify ATOMIC ROLLBACK: order and payment were NOT committed
      const db = getSupabaseClient();
      const { data: dbOrder } = await db.from("order").select("*").eq("order_id", orderId).maybeSingle();
      const { data: dbPayment } = await db.from("payment").select("*").eq("order_id", orderId).maybeSingle();

      expect(dbOrder).toBeNull();
      expect(dbPayment).toBeNull();
    });

    it("4. rolls back entire transaction on order constraint failure (policy DENY)", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("DENY");

      const orderId = randomUUID();
      const idempotencyKey = `idem-fail-deny-${randomUUID()}`;
      const fingerprint = "fp-fail-deny";

      await expect(
        repo.createCheckoutPersistenceAtomic({
          order_id: orderId,
          user_id: USER_A,
          session_id: sessionId,
          mandate_id: MANDATE_A,
          basket_id: basketId,
          policy_decision_id: policyDecisionId,
          gross_amount_minor: 5000,
          discount_amount_minor: 1000,
          final_payable_minor: 4000,
          payment_amount_minor: 4000,
          idempotency_key: idempotencyKey,
          request_fingerprint: fingerprint,
          response_json: {},
        }),
      ).rejects.toThrowError(AppError);

      // Verify ATOMIC ROLLBACK
      const db = getSupabaseClient();
      const { data: dbOrder } = await db.from("order").select("*").eq("order_id", orderId).maybeSingle();
      const { data: dbPayment } = await db.from("payment").select("*").eq("order_id", orderId).maybeSingle();
      const { data: dbIdem } = await db.from("checkout_idempotency").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();

      expect(dbOrder).toBeNull();
      expect(dbPayment).toBeNull();
      expect(dbIdem).toBeNull();
    });

    it("5. rolls back entire transaction on amount mismatch (order final_payable_minor != payment_amount_minor)", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");

      const orderId = randomUUID();
      const idempotencyKey = `idem-fail-mismatch-${randomUUID()}`;
      const fingerprint = "fp-fail-mismatch";

      await expect(
        repo.createCheckoutPersistenceAtomic({
          order_id: orderId,
          user_id: USER_A,
          session_id: sessionId,
          mandate_id: MANDATE_A,
          basket_id: basketId,
          policy_decision_id: policyDecisionId,
          gross_amount_minor: 5000,
          discount_amount_minor: 1000,
          final_payable_minor: 4000,
          payment_amount_minor: 3500, // mismatch
          idempotency_key: idempotencyKey,
          request_fingerprint: fingerprint,
          response_json: {},
        }),
      ).rejects.toThrowError(AppError);

      // Verify ATOMIC ROLLBACK
      const db = getSupabaseClient();
      const { data: dbOrder } = await db.from("order").select("*").eq("order_id", orderId).maybeSingle();
      const { data: dbPayment } = await db.from("payment").select("*").eq("order_id", orderId).maybeSingle();
      const { data: dbIdem } = await db.from("checkout_idempotency").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();

      expect(dbOrder).toBeNull();
      expect(dbPayment).toBeNull();
      expect(dbIdem).toBeNull();
    });

    it("6. preserves and replays existing checkout result on same user + same key + same fingerprint", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");

      const orderId = randomUUID();
      const idempotencyKey = `idem-replay-${randomUUID()}`;
      const fingerprint = "fp-replay-identical";

      // 1. First execution
      const firstResult = await repo.createCheckoutPersistenceAtomic({
        order_id: orderId,
        user_id: USER_A,
        session_id: sessionId,
        mandate_id: MANDATE_A,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        gross_amount_minor: 5000,
        discount_amount_minor: 1000,
        final_payable_minor: 4000,
        payment_amount_minor: 4000,
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint,
        response_json: { test: "replay", order_id: orderId },
      });

      cleanupOrderIds.push(firstResult.order.order_id);
      cleanupPaymentIds.push(firstResult.payment.payment_id);
      cleanupIdempotencyIds.push(firstResult.idempotency.idempotency_id);

      expect(firstResult.replayed).toBe(false);

      // 2. Replay with identical key & fingerprint
      const secondResult = await repo.createCheckoutPersistenceAtomic({
        order_id: randomUUID(), // different candidate order_id
        user_id: USER_A,
        session_id: sessionId,
        mandate_id: MANDATE_A,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        gross_amount_minor: 5000,
        discount_amount_minor: 1000,
        final_payable_minor: 4000,
        payment_amount_minor: 4000,
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint,
        response_json: { test: "replay", order_id: orderId },
      });

      expect(secondResult.replayed).toBe(true);
      expect(secondResult.order.order_id).toBe(orderId);
      expect(secondResult.idempotency.idempotency_key).toBe(idempotencyKey);

      // Ensure no duplicate order was created in DB
      const db = getSupabaseClient();
      const { data: dbOrders } = await db
        .from("order")
        .select("order_id")
        .eq("user_id", USER_A)
        .eq("basket_id", basketId);
      expect(dbOrders).toHaveLength(1);
    });

    it("7. raises IDEMPOTENCY_CONFLICT on same user + same key + different fingerprint without partial rows", async () => {
      const { sessionId, basketId, policyDecisionId } =
        await createAuthorizationFixtures("ALLOW");

      const orderId = randomUUID();
      const idempotencyKey = `idem-conflict-${randomUUID()}`;
      const fingerprint1 = "fp-conflict-1";
      const fingerprint2 = "fp-conflict-2";

      // 1. First execution
      const firstResult = await repo.createCheckoutPersistenceAtomic({
        order_id: orderId,
        user_id: USER_A,
        session_id: sessionId,
        mandate_id: MANDATE_A,
        basket_id: basketId,
        policy_decision_id: policyDecisionId,
        gross_amount_minor: 5000,
        discount_amount_minor: 1000,
        final_payable_minor: 4000,
        payment_amount_minor: 4000,
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint1,
        response_json: { test: "conflict", order_id: orderId },
      });

      cleanupOrderIds.push(firstResult.order.order_id);
      cleanupPaymentIds.push(firstResult.payment.payment_id);
      cleanupIdempotencyIds.push(firstResult.idempotency.idempotency_id);

      // 2. Retry with same key but DIFFERENT fingerprint -> IDEMPOTENCY_CONFLICT
      const conflictingOrderId = randomUUID();
      try {
        await repo.createCheckoutPersistenceAtomic({
          order_id: conflictingOrderId,
          user_id: USER_A,
          session_id: sessionId,
          mandate_id: MANDATE_A,
          basket_id: basketId,
          policy_decision_id: policyDecisionId,
          gross_amount_minor: 5000,
          discount_amount_minor: 1000,
          final_payable_minor: 4000,
          payment_amount_minor: 4000,
          idempotency_key: idempotencyKey,
          request_fingerprint: fingerprint2,
          response_json: { test: "conflict" },
        });
        expect.unreachable("Should have thrown IDEMPOTENCY_CONFLICT");
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe(ErrorCodes.IDEMPOTENCY_CONFLICT);
        expect(appErr.statusCode).toBe(409);
      }

      // Verify no partial conflicting order was inserted
      const db = getSupabaseClient();
      const { data: dbConflictingOrder } = await db
        .from("order")
        .select("order_id")
        .eq("order_id", conflictingOrderId)
        .maybeSingle();
      expect(dbConflictingOrder).toBeNull();
    });
  });
});
