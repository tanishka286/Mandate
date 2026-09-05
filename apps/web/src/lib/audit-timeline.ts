import type { SessionAuditEventView } from "@mandate/types";
import { formatInr } from "@/lib/format-inr";

export interface TimelineEntry {
  id: string;
  eventType: string;
  label: string;
  description: string;
  occurredAt: string;
  amountMinor: number | null;
}

const TIMELINE_EVENT_ORDER = [
  "INTENT_RECEIVED",
  "REQUIREMENTS_CREATED",
  "PRODUCT_RESEARCHED",
  "VOUCHER_EVALUATED",
  "LOYALTY_EVALUATED",
  "BASKET_CREATED",
  "BASKET_RECOMMENDED",
  "BASKET_SELECTED",
  "FRESH_QUOTE",
  "POLICY_ALLOW",
  "POLICY_DENY",
  "RAZORPAY_ORDER_CREATED",
  "PAYMENT_VERIFY_REQUESTED",
  "PAYMENT_VERIFIED",
  "ORDER_CONFIRMED",
  "PAYMENT_FAILED",
] as const;

const EVENT_CONFIG: Record<
  string,
  { label: string; describe: (event: SessionAuditEventView) => string }
> = {
  INTENT_RECEIVED: {
    label: "Goal received",
    describe: (event) => {
      const budget = event.event_data.budget_minor;
      if (typeof budget === "number") {
        return `Shopping intent recorded with ${formatInr(budget, { compact: true })} planning budget.`;
      }
      return "Shopping intent recorded by Mandate.";
    },
  },
  REQUIREMENTS_CREATED: {
    label: "Requirements identified",
    describe: (event) => {
      const ids = event.event_data.requirement_ids;
      if (Array.isArray(ids) && ids.length > 0) {
        return `${ids.length} requirement${ids.length === 1 ? "" : "s"} derived from planning.`;
      }
      return "Requirements derived from planning.";
    },
  },
  PRODUCT_RESEARCHED: {
    label: "Research completed",
    describe: (event) => {
      const signal = event.event_data.quality_signal;
      const evidenceIds = event.event_data.evidence_ids;
      const parts: string[] = ["Products and quality signals evaluated."];
      if (typeof signal === "string") {
        parts.push(`Signal: ${signal}.`);
      }
      if (Array.isArray(evidenceIds) && evidenceIds.length > 0) {
        parts.push(`${evidenceIds.length} evidence reference${evidenceIds.length === 1 ? "" : "s"}.`);
      }
      return parts.join(" ");
    },
  },
  VOUCHER_EVALUATED: {
    label: "Voucher evaluated",
    describe: (event) => {
      const decision = event.event_data.decision;
      return typeof decision === "string"
        ? `Voucher decision: ${decision.replaceAll("_", " ")}.`
        : "Voucher incentive evaluated.";
    },
  },
  LOYALTY_EVALUATED: {
    label: "Loyalty evaluated",
    describe: (event) => {
      const decision = event.event_data.decision;
      return typeof decision === "string"
        ? `Loyalty decision: ${decision.replaceAll("_", " ")}.`
        : "Loyalty incentive evaluated.";
    },
  },
  BASKET_CREATED: {
    label: "Baskets optimized",
    describe: (event) => {
      const type = event.event_data.basket_type;
      const payable = event.event_data.final_payable_minor;
      const typeLabel =
        type === "BEST_VALUE"
          ? "Best Value"
          : type === "BEST_QUALITY"
            ? "Best Quality"
            : "Basket";
      if (typeof payable === "number") {
        return `${typeLabel} basket created at ${formatInr(payable, { compact: true })}.`;
      }
      return `${typeLabel} basket created.`;
    },
  },
  BASKET_RECOMMENDED: {
    label: "Recommendation made",
    describe: (event) => {
      const type = event.event_data.recommended_basket_type;
      if (type === "BEST_VALUE") {
        return "Mandate recommends Best Value.";
      }
      if (type === "BEST_QUALITY") {
        return "Mandate recommends Best Quality.";
      }
      return "Basket recommendation recorded.";
    },
  },
  BASKET_SELECTED: {
    label: "Basket selected",
    describe: () => "User chose a basket — preference recorded, not authorization.",
  },
  FRESH_QUOTE: {
    label: "Fresh quote created",
    describe: (event) => {
      const payable = event.event_data.final_payable_minor;
      const version = event.event_data.quote_version;
      if (typeof payable === "number" && typeof version === "string") {
        return `Price and stock revalidated. ${formatInr(payable, { compact: true })} · ${version}.`;
      }
      return "Price and stock revalidated with a fresh authoritative quote.";
    },
  },
  POLICY_ALLOW: {
    label: "Policy authorization",
    describe: (event) => {
      const payable = event.event_data.final_payable_minor;
      if (typeof payable === "number") {
        return `ALLOW — ${formatInr(payable, { compact: true })} authorized under mandate.`;
      }
      return "ALLOW — purchase authorized under mandate.";
    },
  },
  POLICY_DENY: {
    label: "Policy authorization",
    describe: (event) => {
      const reason = event.event_data.reason_code;
      return typeof reason === "string"
        ? `DENY — ${reason.replaceAll("_", " ")}.`
        : "DENY — purchase blocked by policy.";
    },
  },
  RAZORPAY_ORDER_CREATED: {
    label: "Razorpay order created",
    describe: (event) => {
      const amount = event.event_data.authorized_amount_minor;
      if (typeof amount === "number") {
        return `Secure payment order created for ${formatInr(amount, { compact: true })}.`;
      }
      return "Secure payment order created server-side.";
    },
  },
  PAYMENT_VERIFY_REQUESTED: {
    label: "Payment verification requested",
    describe: () => "Mandate began server-side payment verification.",
  },
  PAYMENT_VERIFIED: {
    label: "Payment verified",
    describe: (event) => {
      const amount = event.event_data.amount_minor ?? event.event_data.verified_amount_minor;
      if (typeof amount === "number") {
        return `Server verified ${formatInr(amount, { compact: true })}.`;
      }
      return "Payment verified by Mandate server.";
    },
  },
  ORDER_CONFIRMED: {
    label: "Order confirmed",
    describe: (event) => {
      const amount = event.event_data.verified_amount_minor;
      if (typeof amount === "number") {
        return `Application order confirmed for ${formatInr(amount, { compact: true })}.`;
      }
      return "Application order confirmed.";
    },
  },
  PAYMENT_FAILED: {
    label: "Payment failed",
    describe: () => "Payment could not be verified.",
  },
};

function amountFromEvent(event: SessionAuditEventView): number | null {
  const data = event.event_data;
  const candidates = [
    data.final_payable_minor,
    data.authorized_amount_minor,
    data.verified_amount_minor,
    data.amount_minor,
    data.gross_amount_minor,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function shouldIncludeInTimeline(eventType: string): boolean {
  return TIMELINE_EVENT_ORDER.includes(eventType as (typeof TIMELINE_EVENT_ORDER)[number]);
}

function collapseResearchEvents(events: SessionAuditEventView[]): SessionAuditEventView[] {
  const result: SessionAuditEventView[] = [];
  let researchIncluded = false;
  let voucherIncluded = false;
  let loyaltyIncluded = false;
  let basketCreatedCount = 0;

  for (const event of events) {
    if (event.event_type === "PRODUCT_RESEARCHED") {
      if (!researchIncluded) {
        result.push(event);
        researchIncluded = true;
      }
      continue;
    }
    if (event.event_type === "VOUCHER_EVALUATED") {
      if (!voucherIncluded) {
        result.push(event);
        voucherIncluded = true;
      }
      continue;
    }
    if (event.event_type === "LOYALTY_EVALUATED") {
      if (!loyaltyIncluded) {
        result.push(event);
        loyaltyIncluded = true;
      }
      continue;
    }
    if (event.event_type === "BASKET_CREATED") {
      basketCreatedCount += 1;
      result.push(event);
      if (basketCreatedCount === 2) {
        const lastIndex = result.length - 1;
        result[lastIndex] = {
          ...event,
          event_type: "BASKET_CREATED",
          event_data: {
            ...event.event_data,
            basket_type: "BOTH",
          },
        };
      }
      continue;
    }
    result.push(event);
  }

  return result.filter((event, index, array) => {
    if (event.event_type !== "BASKET_CREATED") {
      return true;
    }
    const basketType = event.event_data.basket_type;
    if (basketType === "BOTH") {
      return true;
    }
    const laterBoth = array
      .slice(index + 1)
      .some((later) => later.event_type === "BASKET_CREATED" && later.event_data.basket_type === "BOTH");
    return !laterBoth;
  });
}

export function buildDecisionTimeline(
  events: SessionAuditEventView[],
  goalText?: string | null,
): TimelineEntry[] {
  const chronological = [...events]
    .filter((event) => shouldIncludeInTimeline(event.event_type))
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));

  const collapsed = collapseResearchEvents(chronological);

  return collapsed.map((event) => {
    const config = EVENT_CONFIG[event.event_type];
    let description = config
      ? config.describe(event)
      : "Recorded by Mandate audit trail.";

    if (event.event_type === "INTENT_RECEIVED" && goalText) {
      description = `"${goalText}" — ${description}`;
    }

    if (
      event.event_type === "BASKET_CREATED" &&
      event.event_data.basket_type === "BOTH"
    ) {
      description = "Best Value and Best Quality baskets created.";
    }

    return {
      id: event.audit_event_id,
      eventType: event.event_type,
      label: config?.label ?? event.event_type.replaceAll("_", " "),
      description,
      occurredAt: event.occurred_at,
      amountMinor: amountFromEvent(event),
    };
  });
}

export function formatTimelineTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}
