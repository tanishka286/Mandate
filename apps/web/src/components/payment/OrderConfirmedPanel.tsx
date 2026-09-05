"use client";

import { motion, useReducedMotion } from "framer-motion";
import { formatInr } from "@/lib/format-inr";
import type { VerifyPaymentResult } from "@/services/api-client";

export function OrderConfirmedPanel(props: {
  basketLabel: string;
  mandateLabel: string;
  verification: VerifyPaymentResult;
  orderId?: string | null;
}) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const motionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, ease: "easeOut" as const },
      };

  return (
    <motion.section
      {...motionProps}
      className="rounded-2xl border border-[var(--mandate-accent)]/35 bg-[rgba(61,139,110,0.1)] p-6 sm:p-10"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center text-center">
        <div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--mandate-accent)]/20 text-2xl text-[var(--mandate-accent)]"
          aria-hidden="true"
        >
          ✓
        </div>
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
          Order confirmed
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
          Payment verified
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-300">
          Razorpay accepted your payment and Mandate&apos;s server verified it.
          Your grocery basket purchase is confirmed.
        </p>
      </div>

      <div className="mt-8 space-y-4">
        <div className="rounded-xl border border-white/10 bg-black/20 px-5 py-4 text-center">
          <p className="text-xs uppercase tracking-wide text-slate-500">Amount paid</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums text-white">
            {formatInr(props.verification.amount_minor, { compact: true })}
          </p>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Basket</dt>
            <dd className="mt-1 text-sm font-medium text-white">{props.basketLabel}</dd>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Payment</dt>
            <dd className="mt-1 text-sm font-medium text-[var(--mandate-accent)]">
              VERIFIED
            </dd>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Order</dt>
            <dd className="mt-1 text-sm font-medium text-[var(--mandate-accent)]">
              CONFIRMED
            </dd>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Mandate authorization
            </dt>
            <dd className="mt-1 text-sm font-medium text-[var(--mandate-accent)]">
              ALLOW
            </dd>
          </div>
        </dl>

        <div className="rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-xs text-slate-500">
          <p>
            Order ref …{props.verification.order_id.slice(-12)}
            {props.orderId ? ` · ${props.orderId.slice(0, 8)}…` : null}
          </p>
          <p className="mt-1">
            Payment ref …{props.verification.payment_id.slice(-12)} · Razorpay …
            {props.verification.razorpay_payment_id.slice(-8)}
          </p>
          <p className="mt-1">
            Verified {new Date(props.verification.verified_at).toLocaleString()}
          </p>
        </div>
      </div>
    </motion.section>
  );
}
