import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { getEnv, type Env } from "../../config/env.js";
import { AppError, isAppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";

/**
 * Interface representing the subset of the Razorpay SDK client needed by the adapter.
 * Enables dependency injection for deterministic unit testing without live network calls.
 */
export interface RazorpayClientLike {
  orders: {
    create(params: {
      amount: number;
      currency: string;
      receipt: string;
      notes?: Record<string, string>;
    }): Promise<{
      id: string;
      amount: number | string;
      currency: string;
      receipt?: string | null;
      status?: string | null;
    }>;
  };
  payments?: {
    fetch(paymentId: string): Promise<{
      id: string;
      order_id?: string | null;
      amount: number | string;
      currency: string;
      status: string;
      method?: string | null;
    }>;
  };
}

/**
 * Authoritative input to create a Razorpay Test Mode order.
 *
 * NOTE:
 * - amount_minor is authoritative server state (INR paise).
 * - The adapter does not calculate or accept client-controlled amounts.
 * - Currency is strictly "INR" for this MVP.
 * - Receipt uniquely correlates the order without personal data or secrets.
 */
export interface CreateRazorpayOrderInput {
  amount_minor: number;
  currency: "INR";
  receipt: string;
}

/**
 * Minimal sanitized provider response fields required by subsequent backend steps.
 * Raw provider payload is never exposed directly.
 */
export interface CreateRazorpayOrderResult {
  razorpay_order_id: string;
  amount: number;
  currency: "INR";
  receipt: string;
  status: string;
}

export interface VerifyPaymentSignatureInput {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayPaymentDetails {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
}

export interface RazorpayServerAdapterOptions {
  client?: RazorpayClientLike;
  keyId?: string;
  keySecret?: string;
  env?: Env["RAZORPAY_ENV"];
}

function sanitizeErrorMessage(msg: string, secret?: string): string {
  if (!msg) return "Payment provider error";
  let sanitized = msg;
  if (secret && secret.length > 0) {
    sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  }
  sanitized = sanitized.replace(
    /(key_secret|secret|password|token|auth)=[^&\s]+/gi,
    "$1=[REDACTED]",
  );
  return sanitized;
}

/**
 * Build a deterministic application-generated receipt for a given application order ID.
 * Fits within Razorpay's 40-character receipt limit, contains zero personal data,
 * and zero secrets.
 */
export function buildOrderReceipt(orderId: string): string {
  if (!orderId || typeof orderId !== "string" || orderId.trim().length === 0) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Order ID is required to build receipt",
      statusCode: 400,
    });
  }
  const sanitized = orderId.trim().replace(/-/g, "");
  return `rcpt_${sanitized}`.slice(0, 40);
}

/**
 * Server-Side Razorpay Test Mode Adapter.
 *
 * Provider execution boundary for Phase 8 Step 3.
 *
 * Invariants:
 * - Operates ONLY in Test Mode (RAZORPAY_ENV=test).
 * - Never calculates or alters authorized financial amounts.
 * - Uses exact integer minor units (paise for INR).
 * - Never exposes key_secret or webhook_secret.
 * - Server-only: never callable by client, AI, or unauthenticated routes.
 */
export class RazorpayServerAdapter {
  private readonly client: RazorpayClientLike;
  private readonly keySecret?: string;

  constructor(options?: RazorpayServerAdapterOptions) {
    const env = getEnv();
    const targetEnv = options?.env ?? env.RAZORPAY_ENV;

    if (targetEnv !== "test") {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Razorpay adapter is only permitted in Test Mode",
        statusCode: 500,
      });
    }

    if (options?.client) {
      this.client = options.client;
      this.keySecret = options.keySecret ?? env.RAZORPAY_KEY_SECRET;
      return;
    }

    const keyId = options?.keyId ?? env.RAZORPAY_KEY_ID;
    const keySecret = options?.keySecret ?? env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "Razorpay Test Mode credentials are not configured",
        statusCode: 500,
      });
    }

    this.keySecret = keySecret;
    this.client = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  /**
   * Create a Razorpay Test Mode order with an already-authorized integer minor amount.
   */
  async createRazorpayOrder(
    input: CreateRazorpayOrderInput,
  ): Promise<CreateRazorpayOrderResult> {
    if (!input || typeof input !== "object") {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Invalid input to createRazorpayOrder",
        statusCode: 400,
      });
    }

    // 1. Amount Rule: must be positive integer minor units
    if (
      typeof input.amount_minor !== "number" ||
      !Number.isInteger(input.amount_minor) ||
      input.amount_minor <= 0
    ) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Invalid amount_minor: must be a positive integer in minor units (received: ${input.amount_minor})`,
        statusCode: 400,
      });
    }

    // 2. Currency Rule: strictly INR for this MVP
    if (input.currency !== "INR") {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unsupported currency: ${input.currency}. Only INR is supported for this MVP.`,
        statusCode: 400,
      });
    }

    // 3. Receipt Rule: non-empty string up to 40 characters
    if (
      typeof input.receipt !== "string" ||
      input.receipt.trim().length === 0 ||
      input.receipt.length > 40
    ) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Receipt must be a non-empty string of maximum 40 characters",
        statusCode: 400,
      });
    }

    try {
      const response = await this.client.orders.create({
        amount: input.amount_minor,
        currency: "INR",
        receipt: input.receipt.trim(),
      });

      if (!response || typeof response !== "object") {
        throw new AppError({
          code: "PAYMENT_PROVIDER_MALFORMED_RESPONSE",
          message: "Payment provider returned non-object response",
          statusCode: 502,
        });
      }

      if (
        !response.id ||
        typeof response.id !== "string" ||
        response.id.trim().length === 0
      ) {
        throw new AppError({
          code: "PAYMENT_PROVIDER_MALFORMED_RESPONSE",
          message: "Payment provider response is missing order id",
          statusCode: 502,
        });
      }

      return {
        razorpay_order_id: response.id.trim(),
        amount: Number(response.amount),
        currency: "INR",
        receipt: String(response.receipt ?? input.receipt.trim()),
        status: String(response.status ?? "created"),
      };
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }

      const errObj = error as Record<string, unknown>;
      const isTimeout =
        errObj.code === "ECONNABORTED" ||
        errObj.code === "ETIMEDOUT" ||
        String(errObj.message ?? "").toLowerCase().includes("timeout");

      if (isTimeout) {
        throw new AppError({
          code: "PAYMENT_PROVIDER_TIMEOUT",
          message: "Payment provider request timed out",
          statusCode: 504,
          details: { provider: "razorpay", is_timeout: true },
        });
      }

      const providerErrorObj = errObj.error as
        | { description?: string; code?: string }
        | undefined;
      const rawMessage =
        providerErrorObj?.description ||
        (typeof errObj.message === "string"
          ? errObj.message
          : "Payment provider rejected order creation");

      const sanitized = sanitizeErrorMessage(rawMessage, this.keySecret);

      throw new AppError({
        code: "PAYMENT_PROVIDER_ERROR",
        message: sanitized,
        statusCode: 502,
        details: {
          provider: "razorpay",
          provider_error_code: providerErrorObj?.code ?? "PROVIDER_ERROR",
        },
      });
    }
  }

  /**
   * Cryptographically verify the Razorpay payment signature server-side.
   *
   * Invariants:
   * - Uses HMAC-SHA256(order_id + '|' + payment_id, secret).
   * - Uses timingSafeEqual to avoid timing side-channels.
   * - Fails closed on missing or malformed inputs.
   * - Never logs, exposes, or echoes secrets or signatures.
   */
  verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean {
    if (
      !input ||
      typeof input !== "object" ||
      !input.razorpay_order_id ||
      typeof input.razorpay_order_id !== "string" ||
      input.razorpay_order_id.trim().length === 0 ||
      !input.razorpay_payment_id ||
      typeof input.razorpay_payment_id !== "string" ||
      input.razorpay_payment_id.trim().length === 0 ||
      !input.razorpay_signature ||
      typeof input.razorpay_signature !== "string" ||
      input.razorpay_signature.trim().length === 0
    ) {
      return false;
    }

    if (!this.keySecret) {
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "Razorpay key secret is not configured",
        statusCode: 500,
      });
    }

    try {
      const payload = `${input.razorpay_order_id.trim()}|${input.razorpay_payment_id.trim()}`;
      const expectedSignature = createHmac("sha256", this.keySecret)
        .update(payload)
        .digest("hex");

      const expectedBuffer = Buffer.from(expectedSignature, "utf8");
      const providedBuffer = Buffer.from(input.razorpay_signature.trim(), "utf8");

      if (expectedBuffer.length !== providedBuffer.length) {
        return false;
      }

      return timingSafeEqual(expectedBuffer, providedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Authoritatively fetch payment details from the Razorpay provider.
   *
   * Invariants:
   * - Server-side only with test mode credentials.
   * - Returns sanitized provider payment details for correlation and amount reconciliation.
   * - Never exposes raw secrets or provider response blobs.
   */
  async fetchPayment(paymentId: string): Promise<RazorpayPaymentDetails> {
    if (
      !paymentId ||
      typeof paymentId !== "string" ||
      paymentId.trim().length === 0
    ) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Payment ID is required to fetch payment",
        statusCode: 400,
      });
    }

    const trimmedId = paymentId.trim();

    try {
      if (
        !this.client.payments ||
        typeof this.client.payments.fetch !== "function"
      ) {
        throw new AppError({
          code: "PAYMENT_PROVIDER_ERROR",
          message: "Payment provider client does not support payment lookup",
          statusCode: 502,
        });
      }

      const response = await this.client.payments.fetch(trimmedId);

      if (!response || typeof response !== "object") {
        throw new AppError({
          code: "PAYMENT_PROVIDER_MALFORMED_RESPONSE",
          message: "Payment provider returned non-object response for payment lookup",
          statusCode: 502,
        });
      }

      if (
        !response.id ||
        typeof response.id !== "string" ||
        response.id.trim().length === 0
      ) {
        throw new AppError({
          code: "PAYMENT_PROVIDER_MALFORMED_RESPONSE",
          message: "Payment provider response is missing payment id",
          statusCode: 502,
        });
      }

      return {
        razorpay_payment_id: response.id.trim(),
        razorpay_order_id: String(response.order_id ?? "").trim(),
        amount: Number(response.amount),
        currency: String(response.currency ?? "").toUpperCase(),
        status: String(response.status ?? ""),
        method: response.method ? String(response.method) : null,
      };
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }

      const errObj = error as Record<string, unknown>;
      const isTimeout =
        errObj.code === "ECONNABORTED" ||
        errObj.code === "ETIMEDOUT" ||
        String(errObj.message ?? "").toLowerCase().includes("timeout");

      if (isTimeout) {
        throw new AppError({
          code: "PAYMENT_PROVIDER_TIMEOUT",
          message: "Payment provider payment lookup timed out",
          statusCode: 504,
          details: { provider: "razorpay", is_timeout: true },
        });
      }

      const providerErrorObj = errObj.error as
        | { description?: string; code?: string }
        | undefined;
      const rawMessage =
        providerErrorObj?.description ||
        (typeof errObj.message === "string"
          ? errObj.message
          : "Payment provider rejected payment lookup");

      const sanitized = sanitizeErrorMessage(rawMessage, this.keySecret);

      throw new AppError({
        code: "PAYMENT_PROVIDER_ERROR",
        message: sanitized,
        statusCode: 502,
        details: {
          provider: "razorpay",
          provider_error_code: providerErrorObj?.code ?? "PROVIDER_ERROR",
        },
      });
    }
  }
}
