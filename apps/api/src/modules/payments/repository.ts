import { getSupabaseClient } from "../../config/supabase.js";
import { mapDatabaseError } from "../../shared/errors/database.js";
import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { transitionPaymentState } from "./state-machine.js";
import type {
  CreateCheckoutIdempotencyInput,
  CreateOrderInput,
  CreatePaymentInput,
  CreateRazorpayWebhookEventInput,
  CheckoutIdempotencyRecord,
  CheckoutIdempotencyRow,
  Order,
  OrderRow,
  OrderState,
  Payment,
  PaymentRow,
  PaymentState,
  RazorpayWebhookEventRecord,
  RazorpayWebhookEventRow,
  WebhookProcessingStatus,
  CreateCheckoutPersistenceAtomicInput,
  AtomicCheckoutPersistenceResult,
} from "./types.js";

function mapOrderRow(row: OrderRow): Order {
  return {
    order_id: row.order_id,
    user_id: row.user_id,
    session_id: row.session_id,
    mandate_id: row.mandate_id,
    basket_id: row.basket_id,
    policy_decision_id: row.policy_decision_id,
    status: row.status,
    gross_amount_minor: Number(row.gross_amount_minor),
    discount_amount_minor: Number(row.discount_amount_minor),
    final_payable_minor: Number(row.final_payable_minor),
    currency: "INR",
    razorpay_order_id: row.razorpay_order_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapPaymentRow(row: PaymentRow): Payment {
  return {
    payment_id: row.payment_id,
    order_id: row.order_id,
    razorpay_payment_id: row.razorpay_payment_id,
    status: row.status,
    amount_minor: Number(row.amount_minor),
    currency: "INR",
    method: row.method,
    verified_at: row.verified_at,
    failure_code: row.failure_code,
    metadata_json: row.metadata_json ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapCheckoutIdempotencyRow(
  row: CheckoutIdempotencyRow,
): CheckoutIdempotencyRecord {
  return {
    idempotency_id: row.idempotency_id,
    user_id: row.user_id,
    idempotency_key: row.idempotency_key,
    request_fingerprint: row.request_fingerprint,
    order_id: row.order_id,
    response_json: row.response_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapWebhookEventRow(
  row: RazorpayWebhookEventRow,
): RazorpayWebhookEventRecord {
  return {
    webhook_event_id: row.webhook_event_id,
    event_id: row.event_id,
    event_type: row.event_type,
    payload_hash: row.payload_hash,
    received_at: row.received_at,
    processed_at: row.processed_at,
    processing_status: row.processing_status,
    error_code: row.error_code,
    payload_json: row.payload_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Payments repository — Phase 8 Step 2.
 * Authoritative persistence for:
 *   - Canonical Order
 *   - Canonical Payment
 *   - Checkout Idempotency
 *   - Razorpay Webhook Events
 */
export class PaymentsRepository {
  // ---------------------------------------------------------------------------
  // 1. Order Persistence
  // ---------------------------------------------------------------------------

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const db = getSupabaseClient();

    // Verify authorized policy decision exists and is ALLOW
    const { data: policyDecision, error: policyError } = await db
      .from("policy_decision")
      .select("policy_decision_id, decision, basket_id, mandate_id, final_payable_minor")
      .eq("policy_decision_id", input.policy_decision_id)
      .maybeSingle();

    if (policyError) {
      throw mapDatabaseError(policyError, "Failed to verify policy decision");
    }

    if (!policyDecision) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Referenced policy decision does not exist",
        statusCode: 400,
        details: { policy_decision_id: input.policy_decision_id },
      });
    }

    if (policyDecision.decision !== "ALLOW") {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Order creation requires an ALLOW policy decision, found: ${policyDecision.decision}`,
        statusCode: 400,
        details: { policy_decision_id: input.policy_decision_id, decision: policyDecision.decision },
      });
    }

    if (policyDecision.basket_id !== input.basket_id) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Order basket_id does not match authorized policy decision basket_id",
        statusCode: 400,
        details: { input_basket_id: input.basket_id, policy_basket_id: policyDecision.basket_id },
      });
    }

    if (policyDecision.mandate_id !== input.mandate_id) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Order mandate_id does not match authorized policy decision mandate_id",
        statusCode: 400,
        details: { input_mandate_id: input.mandate_id, policy_mandate_id: policyDecision.mandate_id },
      });
    }

    const payload: Record<string, unknown> = {
      user_id: input.user_id,
      session_id: input.session_id,
      mandate_id: input.mandate_id,
      basket_id: input.basket_id,
      policy_decision_id: input.policy_decision_id,
      status: input.status ?? "CREATED",
      gross_amount_minor: input.gross_amount_minor,
      discount_amount_minor: input.discount_amount_minor,
      final_payable_minor: input.final_payable_minor,
      currency: input.currency ?? "INR",
      razorpay_order_id: input.razorpay_order_id ?? null,
    };

    if (input.order_id) {
      payload.order_id = input.order_id;
    }

    const { data, error } = await db
      .from("order")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert order");
    }

    return mapOrderRow(data as OrderRow);
  }

  async findOrderById(orderId: string): Promise<Order | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("order")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load order");
    }

    return data ? mapOrderRow(data as OrderRow) : null;
  }

  async findOrderByRazorpayOrderId(
    razorpayOrderId: string,
  ): Promise<Order | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("order")
      .select("*")
      .eq("razorpay_order_id", razorpayOrderId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load order by razorpay_order_id");
    }

    return data ? mapOrderRow(data as OrderRow) : null;
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderState,
    razorpayOrderId?: string | null,
  ): Promise<Order> {
    const db = getSupabaseClient();
    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (razorpayOrderId !== undefined) {
      updatePayload.razorpay_order_id = razorpayOrderId;
    }

    const { data, error } = await db
      .from("order")
      .update(updatePayload)
      .eq("order_id", orderId)
      .select()
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to update order status");
    }

    return mapOrderRow(data as OrderRow);
  }

  // ---------------------------------------------------------------------------
  // 2. Payment Persistence
  // ---------------------------------------------------------------------------

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    const db = getSupabaseClient();

    // Verify order exists and payment amount matches order final payable
    const order = await this.findOrderById(input.order_id);
    if (!order) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Referenced order does not exist",
        statusCode: 400,
        details: { order_id: input.order_id },
      });
    }

    if (order.final_payable_minor !== input.amount_minor) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Payment amount (${input.amount_minor}) must match order final_payable_minor (${order.final_payable_minor})`,
        statusCode: 400,
        details: {
          input_amount_minor: input.amount_minor,
          order_final_payable_minor: order.final_payable_minor,
        },
      });
    }

    const payload: Record<string, unknown> = {
      order_id: input.order_id,
      razorpay_payment_id: input.razorpay_payment_id ?? null,
      status: input.status ?? "PAYMENT_PENDING",
      amount_minor: input.amount_minor,
      currency: input.currency ?? "INR",
      method: input.method ?? null,
      verified_at: input.verified_at ?? null,
      failure_code: input.failure_code ?? null,
      metadata_json: input.metadata_json ?? {},
    };

    if (input.payment_id) {
      payload.payment_id = input.payment_id;
    }

    const { data, error } = await db
      .from("payment")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert payment");
    }

    return mapPaymentRow(data as PaymentRow);
  }

  async findPaymentById(paymentId: string): Promise<Payment | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("payment")
      .select("*")
      .eq("payment_id", paymentId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load payment");
    }

    return data ? mapPaymentRow(data as PaymentRow) : null;
  }

  async findPaymentByRazorpayPaymentId(
    razorpayPaymentId: string,
  ): Promise<Payment | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("payment")
      .select("*")
      .eq("razorpay_payment_id", razorpayPaymentId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load payment by razorpay_payment_id");
    }

    return data ? mapPaymentRow(data as PaymentRow) : null;
  }

  async findPaymentsByOrderId(orderId: string): Promise<Payment[]> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("payment")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (error) {
      throw mapDatabaseError(error, "Failed to load payments for order");
    }

    return ((data as PaymentRow[]) ?? []).map(mapPaymentRow);
  }

  async updatePaymentStatus(input: {
    paymentId: string;
    status: PaymentState;
    verifiedAt?: string | null;
    failureCode?: string | null;
    metadataJson?: Record<string, unknown>;
  }): Promise<Payment> {
    const existing = await this.findPaymentById(input.paymentId);
    if (!existing) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Payment not found",
        statusCode: 404,
        details: { payment_id: input.paymentId },
      });
    }

    // Apply state machine transition check
    const nextStatus = transitionPaymentState(existing.status, input.status);

    const db = getSupabaseClient();
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    if (input.verifiedAt !== undefined) {
      updatePayload.verified_at = input.verifiedAt;
    }
    if (input.failureCode !== undefined) {
      updatePayload.failure_code = input.failureCode;
    }
    if (input.metadataJson !== undefined) {
      updatePayload.metadata_json = input.metadataJson;
    }

    const { data, error } = await db
      .from("payment")
      .update(updatePayload)
      .eq("payment_id", input.paymentId)
      .select()
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to update payment status");
    }

    return mapPaymentRow(data as PaymentRow);
  }

  // ---------------------------------------------------------------------------
  // 3. Checkout Idempotency Persistence
  // ---------------------------------------------------------------------------

  async findCheckoutIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<CheckoutIdempotencyRecord | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("checkout_idempotency")
      .select("*")
      .eq("user_id", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load checkout idempotency record");
    }

    return data ? mapCheckoutIdempotencyRow(data as CheckoutIdempotencyRow) : null;
  }

  async createCheckoutIdempotency(
    input: CreateCheckoutIdempotencyInput,
  ): Promise<CheckoutIdempotencyRecord> {
    const db = getSupabaseClient();
    const payload: Record<string, unknown> = {
      user_id: input.user_id,
      idempotency_key: input.idempotency_key,
      request_fingerprint: input.request_fingerprint,
      order_id: input.order_id ?? null,
      response_json: input.response_json ?? null,
    };

    if (input.idempotency_id) {
      payload.idempotency_id = input.idempotency_id;
    }

    const { data, error } = await db
      .from("checkout_idempotency")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert checkout idempotency record");
    }

    return mapCheckoutIdempotencyRow(data as CheckoutIdempotencyRow);
  }

  async updateCheckoutIdempotencyResponse(
    idempotencyId: string,
    orderId: string | null,
    responseJson: Record<string, unknown> | null,
  ): Promise<CheckoutIdempotencyRecord> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("checkout_idempotency")
      .update({
        order_id: orderId,
        response_json: responseJson,
        updated_at: new Date().toISOString(),
      })
      .eq("idempotency_id", idempotencyId)
      .select()
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to update checkout idempotency response");
    }

    return mapCheckoutIdempotencyRow(data as CheckoutIdempotencyRow);
  }

  // ---------------------------------------------------------------------------
  // 4. Razorpay Webhook Event Persistence
  // ---------------------------------------------------------------------------

  async createWebhookEvent(
    input: CreateRazorpayWebhookEventInput,
  ): Promise<RazorpayWebhookEventRecord> {
    const db = getSupabaseClient();
    const payload: Record<string, unknown> = {
      event_id: input.event_id,
      event_type: input.event_type,
      payload_hash: input.payload_hash ?? null,
      processing_status: input.processing_status ?? "RECEIVED",
      error_code: input.error_code ?? null,
      payload_json: input.payload_json ?? null,
    };

    if (input.webhook_event_id) {
      payload.webhook_event_id = input.webhook_event_id;
    }
    if (input.received_at) {
      payload.received_at = input.received_at;
    }
    if (input.processed_at) {
      payload.processed_at = input.processed_at;
    }

    const { data, error } = await db
      .from("razorpay_webhook_event")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to insert webhook event");
    }

    return mapWebhookEventRow(data as RazorpayWebhookEventRow);
  }

  async findWebhookEventByEventId(
    eventId: string,
  ): Promise<RazorpayWebhookEventRecord | null> {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from("razorpay_webhook_event")
      .select("*")
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error, "Failed to load webhook event");
    }

    return data ? mapWebhookEventRow(data as RazorpayWebhookEventRow) : null;
  }

  async updateWebhookEventStatus(input: {
    webhookEventId: string;
    processingStatus: WebhookProcessingStatus;
    errorCode?: string | null;
    processedAt?: string | null;
  }): Promise<RazorpayWebhookEventRecord> {
    const db = getSupabaseClient();
    const updatePayload: Record<string, unknown> = {
      processing_status: input.processingStatus,
      updated_at: new Date().toISOString(),
    };

    if (input.errorCode !== undefined) {
      updatePayload.error_code = input.errorCode;
    }
    if (input.processedAt !== undefined) {
      updatePayload.processed_at = input.processedAt;
    }

    const { data, error } = await db
      .from("razorpay_webhook_event")
      .update(updatePayload)
      .eq("webhook_event_id", input.webhookEventId)
      .select()
      .single();

    if (error) {
      throw mapDatabaseError(error, "Failed to update webhook event status");
    }

    return mapWebhookEventRow(data as RazorpayWebhookEventRow);
  }

  // ---------------------------------------------------------------------------
  // 5. Atomic Checkout Persistence (Phase 8 Step 4A)
  // ---------------------------------------------------------------------------

  async createCheckoutPersistenceAtomic(
    input: CreateCheckoutPersistenceAtomicInput,
  ): Promise<AtomicCheckoutPersistenceResult> {
    const db = getSupabaseClient();

    const { data, error } = await db.rpc(
      "create_checkout_persistence_atomic",
      {
        p_order_id: input.order_id,
        p_user_id: input.user_id,
        p_session_id: input.session_id,
        p_mandate_id: input.mandate_id,
        p_basket_id: input.basket_id,
        p_policy_decision_id: input.policy_decision_id,
        p_gross_amount_minor: input.gross_amount_minor,
        p_discount_amount_minor: input.discount_amount_minor,
        p_final_payable_minor: input.final_payable_minor,
        p_payment_amount_minor: input.payment_amount_minor,
        p_idempotency_key: input.idempotency_key,
        p_request_fingerprint: input.request_fingerprint,
        p_response_json: input.response_json,
        p_razorpay_order_id: input.razorpay_order_id ?? null,
        p_payment_id: input.payment_id ?? null,
        p_currency: input.currency ?? "INR",
        p_order_status: input.order_status ?? "PAYMENT_PENDING",
        p_payment_status: input.payment_status ?? "PAYMENT_PENDING",
      },
    );

    if (error) {
      if (error.message?.includes("IDEMPOTENCY_CONFLICT")) {
        throw new AppError({
          code: ErrorCodes.IDEMPOTENCY_CONFLICT,
          message:
            "Idempotency-Key was reused with a materially different checkout request.",
          statusCode: 409,
          details: {
            order_id: input.order_id,
            idempotency_key: input.idempotency_key,
          },
        });
      }
      throw mapDatabaseError(error, "Failed to atomically persist checkout");
    }

    const payload = data as {
      order: OrderRow;
      payment: PaymentRow;
      idempotency: CheckoutIdempotencyRow;
      replayed: boolean;
    };

    return {
      order: mapOrderRow(payload.order),
      payment: mapPaymentRow(payload.payment),
      idempotency: mapCheckoutIdempotencyRow(payload.idempotency),
      replayed: Boolean(payload.replayed),
    };
  }
}
