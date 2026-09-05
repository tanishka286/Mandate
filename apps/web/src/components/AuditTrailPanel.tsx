"use client";

import { useCallback, useState, useTransition } from "react";
import type { SessionAuditEventView } from "@mandate/types";
import { fetchSessionAudit } from "@/services/api-client";

const EVENT_LABELS: Record<string, string> = {
  INTENT_RECEIVED: "Goal received",
  REQUIREMENTS_CREATED: "Requirements created",
  PRODUCT_RESEARCHED: "Research completed",
  BASKET_CREATED: "Basket created",
  VOUCHER_EVALUATED: "Voucher decision",
  LOYALTY_EVALUATED: "Loyalty decision",
  BASKET_RECOMMENDED: "Basket recommended",
  BASKET_SELECTED: "Basket selected",
  POLICY_ALLOW: "Policy ALLOW",
  POLICY_DENY: "Policy DENY",
  RAZORPAY_ORDER_CREATED: "Razorpay order created",
  PAYMENT_VERIFY_REQUESTED: "Payment verify requested",
  PAYMENT_VERIFIED: "Payment verified",
  PAYMENT_FAILED: "Payment failed",
  WEBHOOK_RECEIVED: "Webhook received",
  WEBHOOK_PROCESSED: "Webhook processed",
  AMOUNT_MISMATCH: "Amount mismatch",
  ORDER_CONFIRMED: "Order confirmed",
};

function labelFor(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AuditTrailPanel(props: {
  sessionId: string;
  token: string;
}) {
  const [events, setEvents] = useState<SessionAuditEventView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetchSessionAudit(props.sessionId, props.token);
        setEvents(res.data.events);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load audit trail");
        setEvents(null);
      }
    });
  }, [props.sessionId, props.token]);

  return (
    <section className="space-y-3 rounded-lg border border-white/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Audit trail</h3>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className="rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/15 disabled:opacity-50"
        >
          {pending ? "Loading…" : "Load transaction trace"}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Chronological business events for this session. No secrets or raw
        provider payloads.
      </p>
      {error ? (
        <p className="text-sm text-red-300" role="alert">{error}</p>
      ) : null}
      {events && events.length === 0 ? (
        <p className="text-sm text-slate-400">No audit events recorded yet.</p>
      ) : null}
      {events && events.length > 0 ? (
        <ol className="space-y-2 text-sm">
          {events.map((event) => (
            <li
              key={event.audit_event_id}
              className="rounded-md border border-white/5 bg-black/20 px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-[var(--mandate-accent)]">
                  {labelFor(event.event_type)}
                </span>
                <time className="text-xs text-slate-500">
                  {formatTime(event.occurred_at)}
                </time>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {event.basket_id ? `basket ${event.basket_id.slice(0, 8)}…` : null}
                {event.order_id ? ` · order ${event.order_id.slice(0, 8)}…` : null}
                {event.payment_id ? ` · payment ${event.payment_id.slice(0, 8)}…` : null}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
