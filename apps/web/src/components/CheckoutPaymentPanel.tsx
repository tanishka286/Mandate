"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { BasketQuoteData, BasketSelectionData } from "@mandate/types";
import {
  createCheckout,
  evaluatePolicy,
  verifyPayment,
  type CheckoutResponseData,
  type VerifyPaymentResult,
} from "@/services/api-client";
import { openRazorpayCheckout } from "@/lib/razorpay";

export type PaymentUiState =
  | "idle"
  | "policy_evaluating"
  | "checkout_creating"
  | "checkout_open"
  | "verifying"
  | "verified"
  | "failed"
  | "cancelled";

function formatInr(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`;
}

export function CheckoutPaymentPanel(props: {
  token: string;
  mandateId: string;
  selection: BasketSelectionData;
  quote: BasketQuoteData;
}) {
  const [paymentState, setPaymentState] = useState<PaymentUiState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [checkoutData, setCheckoutData] = useState<CheckoutResponseData | null>(
    null,
  );
  const [verification, setVerification] = useState<VerifyPaymentResult | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const canPay = useMemo(
    () =>
      paymentState === "idle" ||
      paymentState === "failed" ||
      paymentState === "cancelled",
    [paymentState],
  );

  const onPay = useCallback(() => {
    if (!canPay || pending) {
      return;
    }

    setError(null);
    setVerification(null);

    startTransition(async () => {
      try {
        setPaymentState("policy_evaluating");
        const policyIdempotencyKey = crypto.randomUUID();
        const policyRes = await evaluatePolicy(
          props.token,
          policyIdempotencyKey,
          {
            mandate_id: props.mandateId,
            basket_id: props.selection.basket_id,
            quote_version: props.quote.quote_version,
          },
        );

        if (policyRes.data.decision !== "ALLOW") {
          setPaymentState("failed");
          setError("Policy denied checkout");
          return;
        }

        setPaymentState("checkout_creating");
        const checkoutIdempotencyKey = crypto.randomUUID();
        const checkoutRes = await createCheckout(
          props.token,
          checkoutIdempotencyKey,
          {
          selection_id: props.selection.selection_id,
          policy_decision_id: policyRes.data.policy_decision_id,
        });

        const handoff = checkoutRes.data;
        setCheckoutData(handoff);

        if (!handoff.razorpay_key_id) {
          setPaymentState("failed");
          setError("Checkout handoff is missing public Razorpay key");
          return;
        }

        setPaymentState("checkout_open");
        await openRazorpayCheckout({
          key: handoff.razorpay_key_id,
          order_id: handoff.razorpay_order_id,
          amount: handoff.amount_minor,
          currency: handoff.currency,
          name: "Mandate",
          description: "Grocery checkout (Test Mode)",
          handler: async (response) => {
            try {
              setPaymentState("verifying");
              const verifyRes = await verifyPayment(props.token, {
                order_id: handoff.order_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              });

              if (verifyRes.data.status === "VERIFIED") {
                setVerification(verifyRes.data);
                setPaymentState("verified");
              } else {
                setPaymentState("failed");
                setError("Payment verification did not confirm success");
              }
            } catch (verifyError) {
              setPaymentState("failed");
              setError(
                verifyError instanceof Error
                  ? verifyError.message
                  : "Payment verification failed",
              );
            }
          },
          modal: {
            ondismiss: () => {
              if (paymentState !== "verified") {
                setPaymentState("cancelled");
              }
            },
          },
        });
      } catch (checkoutError) {
        setPaymentState("failed");
        setError(
          checkoutError instanceof Error
            ? checkoutError.message
            : "Checkout failed",
        );
      }
    });
  }, [canPay, pending, paymentState, props]);

  return (
    <section className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-4">
      <h3 className="font-medium">Phase 8 · Test Mode checkout</h3>
      <p className="text-sm text-slate-400">
        Razorpay order and amount are created server-side after policy ALLOW.
        The browser only receives the public key and provider order id.
      </p>

      {checkoutData ? (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-slate-500">Order</dt>
            <dd className="font-mono text-xs">{checkoutData.order_id}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Authorized amount</dt>
            <dd className="tabular-nums">
              {formatInr(checkoutData.amount_minor)}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onPay}
          disabled={!canPay || pending}
          className="rounded-md bg-[var(--mandate-accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {pending ? "Processing…" : "Pay with Razorpay (Test Mode)"}
        </button>
        <span className="text-xs text-slate-500">
          State: {paymentState.replaceAll("_", " ")}
        </span>
      </div>

      {paymentState === "verified" && verification ? (
        <p className="text-sm text-[var(--mandate-accent)]" role="status">
          Payment verified by server · {formatInr(verification.amount_minor)} ·{" "}
          {verification.razorpay_payment_id}
        </p>
      ) : null}

      {paymentState === "failed" || paymentState === "cancelled" ? (
        <p className="text-sm text-red-300" role="alert">
          {paymentState === "cancelled"
            ? "Checkout cancelled. You can retry when ready."
            : error ?? "Payment failed"}
        </p>
      ) : null}

      {paymentState === "verifying" ? (
        <p className="text-sm text-slate-300" role="status">
          Verifying payment with server…
        </p>
      ) : null}
    </section>
  );
}
