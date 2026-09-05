import type { SessionAuditEventView } from "@mandate/types";

export interface IncentiveDecisionView {
  kind: "VOUCHER" | "LOYALTY";
  incentiveId: string;
  decision: string;
  reason: string | null;
}

export interface ResearchObservationView {
  productId: string;
  skuId: string | null;
  evidenceIds: string[];
  qualitySignal: string | null;
  confidence: number | null;
  sourceType: string | null;
}

export interface SessionContextView {
  goalText: string | null;
  budgetMinor: number | null;
  requirementsCreated: boolean;
  requirementIds: string[];
  incentives: IncentiveDecisionView[];
  research: ResearchObservationView[];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function buildSessionContextFromAudit(
  events: SessionAuditEventView[],
  goalTextOverride?: string | null,
): SessionContextView {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  );

  let budgetMinor: number | null = null;
  let requirementsCreated = false;
  const requirementIds: string[] = [];
  const incentiveMap = new Map<string, IncentiveDecisionView>();
  const researchMap = new Map<string, ResearchObservationView>();

  for (const event of sorted) {
    const data = event.event_data;

    if (event.event_type === "INTENT_RECEIVED") {
      budgetMinor = asNumber(data.budget_minor);
    }

    if (event.event_type === "REQUIREMENTS_CREATED") {
      requirementsCreated = true;
      for (const id of asStringArray(data.requirement_ids)) {
        if (!requirementIds.includes(id)) {
          requirementIds.push(id);
        }
      }
    }

    if (
      event.event_type === "VOUCHER_EVALUATED" ||
      event.event_type === "LOYALTY_EVALUATED"
    ) {
      const incentiveId = asString(data.incentive_id);
      const decision = asString(data.decision);
      if (!incentiveId || !decision) {
        continue;
      }
      incentiveMap.set(incentiveId, {
        kind: event.event_type === "VOUCHER_EVALUATED" ? "VOUCHER" : "LOYALTY",
        incentiveId,
        decision,
        reason: asString(data.reason),
      });
    }

    if (event.event_type === "PRODUCT_RESEARCHED") {
      const productId = asString(data.product_id);
      if (!productId) {
        continue;
      }
      const key = `${productId}:${asString(data.sku_id) ?? "all"}`;
      researchMap.set(key, {
        productId,
        skuId: asString(data.sku_id),
        evidenceIds: asStringArray(data.evidence_ids),
        qualitySignal: asString(data.quality_signal),
        confidence: asNumber(data.confidence),
        sourceType: asString(data.source_type),
      });
    }
  }

  return {
    goalText: goalTextOverride ?? null,
    budgetMinor,
    requirementsCreated,
    requirementIds,
    incentives: [...incentiveMap.values()],
    research: [...researchMap.values()],
  };
}
