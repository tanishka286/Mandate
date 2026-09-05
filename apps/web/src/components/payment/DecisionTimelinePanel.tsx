"use client";

import type { SessionAuditEventView } from "@mandate/types";
import { motion, useReducedMotion } from "framer-motion";
import {
  buildDecisionTimeline,
  formatTimelineTime,
} from "@/lib/audit-timeline";
import { formatInr } from "@/lib/format-inr";

export function DecisionTimelinePanel(props: {
  events: SessionAuditEventView[];
  goalText?: string | null;
  defaultExpanded?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const entries = buildDecisionTimeline(props.events, props.goalText);

  if (entries.length === 0) {
    return (
      <section className="rounded-2xl border border-white/10 bg-black/20 p-6">
        <h3 className="text-lg font-medium text-white">How Mandate decided</h3>
        <p className="mt-2 text-sm text-slate-400">
          Audit events will appear here as Mandate records authoritative decisions.
        </p>
      </section>
    );
  }

  const motionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, ease: "easeOut" as const },
      };

  return (
    <motion.section
      {...motionProps}
      className="rounded-2xl border border-white/10 bg-black/20 p-6 sm:p-8"
    >
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
          Audit trail
        </p>
        <h3 className="text-xl font-medium text-white sm:text-2xl">
          How Mandate decided
        </h3>
        <p className="text-sm text-slate-400">
          Chronological record from the authoritative audit API — no frontend-only events.
        </p>
      </header>

      <ol className="mt-6 space-y-4" aria-label="Decision timeline">
        {entries.map((entry, index) => (
          <li key={entry.id} className="flex gap-3">
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--mandate-accent)]/20 text-[var(--mandate-accent)]"
              aria-hidden="true"
            >
              ✓
            </span>
            <div className="min-w-0 flex-1 border-b border-white/6 pb-4 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-white">{entry.label}</p>
                <time className="text-xs text-slate-500">
                  {formatTimelineTime(entry.occurredAt)}
                </time>
              </div>
              <p className="mt-1 text-sm text-slate-400">{entry.description}</p>
              {entry.amountMinor != null &&
              ["FRESH_QUOTE", "POLICY_ALLOW", "PAYMENT_VERIFIED", "ORDER_CONFIRMED", "RAZORPAY_ORDER_CREATED"].includes(
                entry.eventType,
              ) ? (
                <p className="mt-1 text-xs tabular-nums text-slate-500">
                  {formatInr(entry.amountMinor, { compact: true })}
                </p>
              ) : null}
              {index === entries.length - 1 ? null : null}
            </div>
          </li>
        ))}
      </ol>
    </motion.section>
  );
}
