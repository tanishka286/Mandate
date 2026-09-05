"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import type { BasketQuoteData, BasketSelectionData } from "@mandate/types";
import {
  createCheckout,
  evaluatePolicy,
  verifyPayment,
  type CheckoutResponseData,
  type VerifyPaymentResult,
} from "@/services/api-client";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { formatInr } from "@/lib/format-inr";
import { isPolicyDeniedError, type PolicyDenyDetails } from "@/lib/policy-errors";

export type PaymentUiState =
  | "idle"
  | "policy_evaluating"
  | "checkout_creating"
  | "checkout_open"
  | "verifying"
  | "verified"
  | "failed"
  | "cancelled";

function paymentStatusMessage(state: PaymentUiState): string | null {
  switch (state) {
    case "policy_evaluating":
      return "Preparing secure payment…";
    case "checkout_creating":
      return "Creating Razorpay order on the server…";
    case "checkout_open":
      return "Razorpay checkout is open — complete payment in the secure window.";
    case "verifying":
      return "Verifying payment with Mandate server…";
    case "verified":
      return "Payment verified by server.";
    default:
      return null;
  }
}

export function CheckoutPaymentPanel(props: {
  token: string;
  mandateId: string;
  selection: BasketSelectionData;
  quote: BasketQuoteData;
  policyDecisionId?: string;
  basketLabel: string;
  mandateLabel: string;
  authorizedAmountMinor: number;
  onVerified?: (result: {
    verification: VerifyPaymentResult;
    checkout: CheckoutResponseData;
  }) => void;
  onPolicyDenied?: (details: PolicyDenyDetails) => void;
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
  const verifiedRef = useRef(false);
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);

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
    verifiedRef.current = false;

    if (!checkoutIdempotencyKeyRef.current) {
      checkoutIdempotencyKeyRef.current = `checkout-${props.selection.selection_id}-${props.quote.quote_version}`;
    }

    startTransition(async () => {
      try {
        let policyDecisionId = props.policyDecisionId;

        if (!policyDecisionId) {
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
          policyDecisionId = policyRes.data.policy_decision_id;
        }

        setPaymentState("checkout_creating");
        const checkoutRes = await createCheckout(
          props.token,
          checkoutIdempotencyKeyRef.current!,
          {
            selection_id: props.selection.selection_id,
            policy_decision_id: policyDecisionId,
          },
        );

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
                verifiedRef.current = true;
                setVerification(verifyRes.data);
                setPaymentState("verified");
                props.onVerified?.({
                  verification: verifyRes.data,
                  checkout: handoff,
                });
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
              if (!verifiedRef.current) {
                setPaymentState("cancelled");
              }
            },
          },
        });
      } catch (checkoutError) {
        if (isPolicyDeniedError(checkoutError)) {
          setPaymentState("failed");
          setError(checkoutError.details.message);
          props.onPolicyDenied?.(checkoutError.details);
          return;
        }
        setPaymentState("failed");
        setError(
          checkoutError instanceof Error
            ? checkoutError.message
            : "Checkout failed",
        );
      }
    });
  }, [canPay, pending, props]);

  const statusMessage = paymentStatusMessage(paymentState);

  if (paymentState === "verified" && verification) {
    return null;
  }

  return (
    <section className="space-y-5 rounded-2xl border border-white/10 bg-black/25 p-5 sm:p-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
          Payment
        </p>
        <h3 className="text-lg font-medium text-white sm:text-xl">
          Razorpay executes the authorized purchase
        </h3>
      </header>

      <dl className="grid gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Basket</dt>
          <dd className="mt-1 font-medium text-slate-200">{props.basketLabel}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Mandate</dt>
          <dd className="mt-1 font-medium text-slate-200">{props.mandateLabel}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Fresh quote</dt>
          <dd className="mt-1 tabular-nums font-medium text-slate-200">
            {formatInr(props.quote.final_payable_minor, { compact: true })}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Authorized amount</dt>
          <dd className="mt-1 tabular-nums font-medium text-white">
            {formatInr(props.authorizedAmountMinor, { compact: true })}
          </dd>
        </div>
      </dl>

      <ul className="grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
        <li>✓ Policy approved</li>
        <li>✓ Amount verified</li>
        <li>✓ Ready for secure payment</li>
      </ul>

      {checkoutData ? (
        <p className="text-xs text-slate-500">
          Server order …{checkoutData.order_id.slice(-12)} · Razorpay amount{" "}
          {formatInr(checkoutData.amount_minor, { compact: true })}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onPay}
          disabled={!canPay || pending}
          className="inline-flex items-center justify-center rounded-xl bg-[var(--mandate-accent)] px-5 py-3.5 text-base font-medium text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mandate-accent)]/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Processing…" : "Pay with Razorpay"}
        </button>
        {statusMessage ? (
          <p className="text-sm text-slate-400" role="status" aria-live="polite">
            {statusMessage}
          </p>
        ) : null}
      </div>

      {paymentState === "failed" || paymentState === "cancelled" ? (
        <div
          className="rounded-xl border border-red-400/25 bg-red-950/30 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          <p className="font-medium text-red-100">
            {paymentState === "cancelled"
              ? "Payment wasn't completed"
              : "Payment wasn't completed"}
          </p>
          <p className="mt-1">
            {paymentState === "cancelled"
              ? "Checkout was closed before payment finished. Your basket and authorization are unchanged."
              : error ?? "Payment failed. Your basket and authorization are unchanged."}
          </p>
          <button
            type="button"
            onClick={onPay}
            disabled={pending}
            className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Try again
          </button>
        </div>
      ) : null}

      {paymentState === "verifying" ? (
        <p className="text-sm text-slate-300" role="status">
          Do not close this page — Mandate is verifying your payment server-side.
        </p>
      ) : null}
    </section>
  );
}
