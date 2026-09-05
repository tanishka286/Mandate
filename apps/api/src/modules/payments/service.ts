import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { PaymentsRepository } from "./repository.js";
import { RazorpayServerAdapter } from "./razorpay-adapter.js";
import type {
  VerifyPaymentInput,
  VerifyPaymentResult,
} from "./types.js";

/**
 * Payments Service — Phase 8 Step 6.
 *
 * Authoritative server-side payment verification boundary.
 *
 * Invariants:
 * 1. Client callback evidence is NOT trusted.
 * 2. Authenticated user identity must own the application order.
 * 3. Razorpay order ID must correlate with canonical order.
 * 4. Razorpay signature verification is cryptographic, server-side only (HMAC-SHA256).
 * 5. Provider payment is fetched authoritatively and correlated with Razorpay order.
 * 6. Amount is strictly reconciled: provider amount === order.final_payable_minor.
 * 7. Currency is strictly server-authoritative ("INR").
 * 8. Payment state transition to VERIFIED follows deterministic state machine.
 * 9. Idempotent: repeated compatible verifications replay existing VERIFIED state.
 * 10. Atomic: payment and order status updates commit in a single transaction.
 * 11. Zero secrets or sensitive signatures are leaked or logged.
 */
export class PaymentsService {
  constructor(
    private readonly paymentsRepo = new PaymentsRepository(),
    private readonly razorpayAdapter = new RazorpayServerAdapter(),
  ) {}

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    // 1. Load canonical application order
    const order = await this.paymentsRepo.findOrderById(input.order_id);
    if (!order) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Application order not found",
        statusCode: 404,
        details: { order_id: input.order_id },
      });
    }

    // 2. Order ownership check: order must belong to authenticated user
    if (order.user_id !== input.user_id) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Order does not belong to authenticated user",
        statusCode: 403,
      });
    }

    // 3. Razorpay order ID correlation
    if (!order.razorpay_order_id || input.razorpay_order_id !== order.razorpay_order_id) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Submitted Razorpay order ID does not match application order",
        statusCode: 400,
        details: {
          submitted_order_id: input.razorpay_order_id,
          expected_order_id: order.razorpay_order_id,
        },
      });
    }

    // 4. Load application payment record
    const payments = await this.paymentsRepo.findPaymentsByOrderId(order.order_id);
    const payment = payments[payments.length - 1];
    if (!payment) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Payment record not found for application order",
        statusCode: 404,
        details: { order_id: order.order_id },
      });
    }

    // 5. Idempotency & Terminal State Preconditions
    if (payment.status === "VERIFIED") {
      // Check identifier compatibility
      if (payment.razorpay_payment_id === input.razorpay_payment_id) {
        // Repeated compatible verification: verify signature first (fail closed if invalid)
        const isSigValid = this.razorpayAdapter.verifyPaymentSignature({
          razorpay_order_id: input.razorpay_order_id,
          razorpay_payment_id: input.razorpay_payment_id,
          razorpay_signature: input.razorpay_signature,
        });

        if (!isSigValid) {
          throw new AppError({
            code: "PAYMENT_SIGNATURE_INVALID",
            message: "Invalid payment verification signature",
            statusCode: 400,
          });
        }

        return {
          payment_id: payment.payment_id,
          order_id: order.order_id,
          status: "VERIFIED",
          razorpay_payment_id: payment.razorpay_payment_id,
          amount_minor: payment.amount_minor,
          verified_at: payment.verified_at!,
        };
      }

      // Conflicting provider identifiers on already verified payment
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: "Payment is already verified with different provider identifiers",
        statusCode: 409,
        details: {
          order_id: order.order_id,
          existing_payment_id: payment.razorpay_payment_id,
          submitted_payment_id: input.razorpay_payment_id,
        },
      });
    }

    if (payment.status !== "PAYMENT_PENDING") {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: `Illegal payment state transition: ${payment.status} → VERIFIED`,
        statusCode: 409,
        details: {
          from: payment.status,
          to: "VERIFIED",
        },
      });
    }

    // 6. Cryptographic Razorpay Signature Verification
    const isSignatureValid = this.razorpayAdapter.verifyPaymentSignature({
      razorpay_order_id: input.razorpay_order_id,
      razorpay_payment_id: input.razorpay_payment_id,
      razorpay_signature: input.razorpay_signature,
    });

    if (!isSignatureValid) {
      throw new AppError({
        code: "PAYMENT_SIGNATURE_INVALID",
        message: "Invalid payment verification signature",
        statusCode: 400,
      });
    }

    // 7. Provider Payment Lookup & Correlation
    const providerPayment = await this.razorpayAdapter.fetchPayment(
      input.razorpay_payment_id,
    );

    if (providerPayment.razorpay_order_id !== order.razorpay_order_id) {
      throw new AppError({
        code: "PAYMENT_PROVIDER_ORDER_MISMATCH",
        message: "Provider payment does not correlate to the expected Razorpay order",
        statusCode: 400,
        details: {
          provider_order_id: providerPayment.razorpay_order_id,
          expected_order_id: order.razorpay_order_id,
        },
      });
    }

    if (providerPayment.razorpay_payment_id !== input.razorpay_payment_id) {
      throw new AppError({
        code: "PAYMENT_PROVIDER_PAYMENT_MISMATCH",
        message: "Provider payment identifier mismatch",
        statusCode: 400,
      });
    }

    if (providerPayment.status === "failed") {
      throw new AppError({
        code: "PAYMENT_PROVIDER_ERROR",
        message: "Payment was not successful with payment provider",
        statusCode: 400,
      });
    }

    // 8. Financial Invariant: Amount Reconciliation
    if (
      providerPayment.amount !== order.final_payable_minor ||
      providerPayment.amount !== payment.amount_minor
    ) {
      throw new AppError({
        code: "PAYMENT_AMOUNT_MISMATCH",
        message: "Observed provider payment amount does not match authorized order amount",
        statusCode: 422,
        details: {
          observed_amount_minor: providerPayment.amount,
          expected_order_amount_minor: order.final_payable_minor,
          persisted_payment_amount_minor: payment.amount_minor,
        },
      });
    }

    // 9. Financial Invariant: Currency Reconciliation
    if (
      providerPayment.currency !== "INR" ||
      order.currency !== "INR" ||
      payment.currency !== "INR"
    ) {
      throw new AppError({
        code: "PAYMENT_CURRENCY_MISMATCH",
        message: "Payment currency mismatch: only INR is supported",
        statusCode: 422,
        details: {
          provider_currency: providerPayment.currency,
          order_currency: order.currency,
        },
      });
    }

    // 10. Atomic State Transition & Safe Persistence
    const verifiedAt = new Date().toISOString();
    const persistenceResult =
      await this.paymentsRepo.verifyPaymentPersistenceAtomic({
        order_id: order.order_id,
        payment_id: payment.payment_id,
        razorpay_payment_id: input.razorpay_payment_id,
        verified_at: verifiedAt,
        method: providerPayment.method,
      });

    // 11. Return sanitized verification result
    return {
      payment_id: persistenceResult.payment.payment_id,
      order_id: persistenceResult.order.order_id,
      status: "VERIFIED",
      razorpay_payment_id: persistenceResult.payment.razorpay_payment_id!,
      amount_minor: persistenceResult.payment.amount_minor,
      verified_at: persistenceResult.payment.verified_at ?? verifiedAt,
    };
  }
}
