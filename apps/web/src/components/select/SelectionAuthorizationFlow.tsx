"use client";

import type { BasketQuoteData, BasketSelectionData } from "@mandate/types";
import { motion, useReducedMotion } from "framer-motion";
import { formatInr } from "@/lib/format-inr";
import { policyReasonLabel } from "@/lib/policy-reason-labels";
import type { PolicyEvaluateAllowData } from "@/services/api-client";
import type { PolicyDenyDetails } from "@/lib/policy-errors";
import type { VerifyPaymentResult } from "@/services/api-client";
import type { CheckoutResponseData } from "@/services/api-client";
import { CheckoutPaymentPanel } from "@/components/CheckoutPaymentPanel";
import { mandateLabelForId } from "@/lib/mandate-labels";

export type SelectionFlowPhase =
  | "idle"
  | "selecting"
  | "quoting"
  | "policy_checking"
  | "authorized"
  | "denied"
  | "error";

export function SelectionProgress(props: {
  phase: SelectionFlowPhase;
  recoveryMode?: boolean;
}) {
  const steps = props.recoveryMode
    ? [
        { id: "selecting", label: "Alternative selected" },
        { id: "quoting", label: "Refreshing price" },
        { id: "policy_checking", label: "Checking mandate again" },
      ]
    : [
        { id: "selecting", label: "Basket selected" },
        { id: "quoting", label: "Refreshing your price" },
        { id: "policy_checking", label: "Checking your mandate" },
      ];

  const activeIndex =
    props.phase === "selecting"
      ? 0
      : props.phase === "quoting"
        ? 1
        : props.phase === "policy_checking"
          ? 2
          : -1;

  if (activeIndex < 0) {
    return null;
  }

  return (
    <div
      className="rounded-xl border border-white/10 bg-black/25 px-4 py-4"
      role="status"
      aria-live="polite"
    >
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const complete = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li
              key={step.id}
              className={
                active
                  ? "text-sm font-medium text-white"
                  : complete
                    ? "text-sm text-slate-400"
                    : "text-sm text-slate-600"
              }
            >
              {complete ? "✓ " : active ? "→ " : "○ "}
              {step.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function FreshQuotePanel(props: { quote: BasketQuoteData }) {
  const { quote } = props;

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--mandate-accent)]/30 bg-black/25 p-6">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
          Commerce authority
        </p>
        <h3 className="text-lg font-medium text-white">Fresh authoritative quote</h3>
        <p className="text-sm text-slate-400">
          Prices and stock were revalidated just now. Quote version{" "}
          <span className="font-mono text-slate-300">{quote.quote_version}</span>
        </p>
      </header>

      <ul className="space-y-2 border-t border-white/8 pt-4 text-sm">
        {quote.lines.map((line) => (
          <li
            key={`${line.sku_id}-${line.quantity}`}
            className="flex items-baseline justify-between gap-3 text-slate-300"
          >
            <span>
              SKU …{line.sku_id.slice(-8)} × {line.quantity}
            </span>
            <span className="tabular-nums text-slate-200">
              {formatInr(line.line_amount_minor, { compact: true })}
            </span>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-3 gap-3 border-t border-white/8 pt-4 text-sm">
        <div>
          <dt className="text-slate-500">Subtotal</dt>
          <dd className="mt-1 tabular-nums text-lg text-slate-200">
            {formatInr(quote.gross_amount_minor, { compact: true })}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Discount</dt>
          <dd className="mt-1 tabular-nums text-lg text-slate-200">
            {formatInr(quote.discount_amount_minor, { compact: true })}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Final payable</dt>
          <dd className="mt-1 tabular-nums text-lg font-semibold text-white">
            {formatInr(quote.final_payable_minor, { compact: true })}
          </dd>
        </div>
      </dl>

      {quote.applied_incentives.length > 0 ? (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-xs text-slate-400">
          Applied incentives recorded by the backend:{" "}
          {quote.applied_incentives
            .map((item) => `${item.kind} (${formatInr(item.benefit_minor, { compact: true })})`)
            .join(" · ")}
        </div>
      ) : null}
    </section>
  );
}

export function PolicyAuthorizationPanel(props: {
  allow: PolicyEvaluateAllowData | null;
  deny: PolicyDenyDetails | null;
  mandateId?: string;
  token?: string;
  selection: BasketSelectionData | null;
  quote: BasketQuoteData | null;
  basketLabel?: string;
  recoveryApproved?: boolean;
  recoveryFailed?: boolean;
  onPaymentVerified?: (result: {
    verification: VerifyPaymentResult;
    checkout: CheckoutResponseData;
  }) => void;
  onChooseAlternative?: () => void;
  onReturnToComparison?: () => void;
  onPolicyDeniedAtCheckout?: (details: PolicyDenyDetails) => void;
}) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const motionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, ease: "easeOut" as const },
      };

  if (props.allow) {
    return (
      <motion.section
        {...motionProps}
        className="space-y-5 rounded-2xl border border-[var(--mandate-accent)]/35 bg-[rgba(61,139,110,0.08)] p-6 sm:p-8"
      >
        {props.recoveryApproved ? (
          <div className="rounded-xl border border-[var(--mandate-accent)]/30 bg-[var(--mandate-accent)]/10 px-4 py-3">
            <p className="text-sm font-medium text-[var(--mandate-accent)]">
              Alternative approved
            </p>
            <p className="mt-1 text-sm text-slate-300">
              The first basket was blocked, so Mandate found another feasible option
              and rechecked it. Your new basket is within your mandate.
            </p>
          </div>
        ) : null}

        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
            Policy authorization
          </p>
          <h3 className="text-2xl font-semibold text-white">
            ALLOW — authorized for payment
          </h3>
          <p className="text-sm text-slate-300">
            Policy independently approved the fresh quote. Payment executes only
            after you explicitly start Razorpay checkout.
          </p>
        </header>

        <ul className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
          <li>✓ Mandate valid</li>
          <li>✓ Final amount calculated</li>
          <li>✓ Policy version {props.allow.policy_version}</li>
          <li>✓ Within spending limit</li>
        </ul>

        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Authorized amount
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-white">
            {formatInr(props.allow.final_payable_minor, { compact: true })}
          </p>
        </div>

        {props.mandateId && props.token && props.selection && props.quote ? (
          <CheckoutPaymentPanel
            token={props.token}
            mandateId={props.mandateId}
            selection={props.selection}
            quote={props.quote}
            policyDecisionId={props.allow.policy_decision_id}
            basketLabel={props.basketLabel ?? "Selected basket"}
            mandateLabel={mandateLabelForId(props.mandateId)}
            authorizedAmountMinor={props.allow.final_payable_minor}
            onVerified={props.onPaymentVerified}
            onPolicyDenied={props.onPolicyDeniedAtCheckout}
          />
        ) : null}
      </motion.section>
    );
  }

  if (props.deny) {
    const showRecoveryCta =
      props.onChooseAlternative && !props.recoveryFailed;
    const headline = props.recoveryFailed
      ? "That option is also outside your mandate"
      : "This basket is not authorized under your current mandate";

    return (
      <motion.section
        {...motionProps}
        className="space-y-5 rounded-2xl border border-red-400/25 bg-red-950/20 p-6 sm:p-8"
        role="alert"
      >
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-red-300/90">
            Payment blocked
          </p>
          <h3 className="text-2xl font-semibold text-white">{headline}</h3>
          <p className="text-sm text-red-100/90">{props.deny.message}</p>
        </header>

        {props.basketLabel ? (
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Selected basket
            </p>
            <p className="mt-1 text-lg font-medium text-white">{props.basketLabel}</p>
          </div>
        ) : null}

        <dl className="grid gap-4 sm:grid-cols-2">
          {props.deny.final_payable_minor != null ? (
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Fresh payable
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-white">
                {formatInr(props.deny.final_payable_minor, { compact: true })}
              </dd>
            </div>
          ) : null}
          {props.deny.max_spend_minor != null ? (
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Your spending limit
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-white">
                {formatInr(props.deny.max_spend_minor, { compact: true })}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="rounded-xl border border-white/8 bg-black/20 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Reason</p>
          <p className="mt-1 font-mono text-sm text-white">
            {policyReasonLabel(props.deny.code)}
          </p>
        </div>

        <p className="text-sm text-slate-400">
          Your mandate was not changed.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {showRecoveryCta ? (
            <button
              type="button"
              onClick={props.onChooseAlternative}
              className="inline-flex rounded-xl bg-white/10 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Choose another option
            </button>
          ) : null}
          {props.onReturnToComparison ? (
            <button
              type="button"
              onClick={props.onReturnToComparison}
              className="inline-flex rounded-xl border border-white/15 bg-transparent px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Return to basket comparison
            </button>
          ) : null}
        </div>
      </motion.section>
    );
  }

  return null;
}
