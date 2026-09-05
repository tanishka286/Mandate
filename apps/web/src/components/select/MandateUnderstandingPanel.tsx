"use client";

import type { BasketView } from "@mandate/types";
import { motion, useReducedMotion } from "framer-motion";
import { formatInr } from "@/lib/format-inr";
import type { ParsedRequirement } from "@/lib/parse-combination-key";
import type { SessionContextView } from "@/lib/session-context";

const cardClassName =
  "rounded-2xl border border-white/10 bg-black/20 p-6 shadow-xl shadow-black/20 sm:p-8";

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
        {eyebrow}
      </p>
      <h2 className="text-xl font-medium text-white sm:text-2xl">{title}</h2>
      {description ? (
        <p className="text-sm leading-relaxed text-slate-400">{description}</p>
      ) : null}
    </header>
  );
}

function formatDecisionLabel(decision: string): string {
  return decision.replaceAll("_", " ");
}

export function MandateUnderstandingPanel(props: {
  sessionContext: SessionContextView;
  requirements: ParsedRequirement[];
  evidenceSummaries: string[];
  skuLabels: Map<string, string>;
}) {
  const { sessionContext, requirements, evidenceSummaries, skuLabels } = props;
  const prefersReducedMotion = useReducedMotion() ?? false;
  const motionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, ease: "easeOut" as const },
      };

  const voucherDecisions = sessionContext.incentives.filter(
    (item) => item.kind === "VOUCHER",
  );
  const loyaltyDecisions = sessionContext.incentives.filter(
    (item) => item.kind === "LOYALTY",
  );

  const hasResearch =
    sessionContext.research.length > 0 || evidenceSummaries.length > 0;
  const hasIncentives = sessionContext.incentives.length > 0;

  return (
    <motion.section {...motionProps} className={`${cardClassName} space-y-8`}>
      <SectionHeading
        eyebrow="Mandate intelligence"
        title="What Mandate understood"
        description="Requirements, research, and incentive decisions recorded by the backend during planning."
      />

      <div className="space-y-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Your goal
        </p>
        {sessionContext.goalText ? (
          <p className="text-sm leading-relaxed text-slate-200">
            &ldquo;{sessionContext.goalText}&rdquo;
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            Research details available in Mandate&apos;s decision record.
          </p>
        )}
        {sessionContext.budgetMinor != null ? (
          <p className="text-xs text-slate-500">
            Planning budget {formatInr(sessionContext.budgetMinor, { compact: true })}
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-white">Requirements</h3>
        {requirements.length > 0 ? (
          <ul className="space-y-3">
            {requirements.map((requirement) => {
              const skuLabel = skuLabels.get(requirement.skuId);
              return (
                <li
                  key={`${requirement.index}-${requirement.name}`}
                  className="flex gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
                >
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--mandate-accent)]/20 text-[var(--mandate-accent)]"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium capitalize text-slate-200">
                      {requirement.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      Required quantity: {requirement.quantity}
                      {skuLabel ? ` · ${skuLabel}` : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : sessionContext.requirementsCreated ? (
          <p className="text-sm text-slate-400">
            {sessionContext.requirementIds.length} requirement
            {sessionContext.requirementIds.length === 1 ? "" : "s"} recorded by
            Mandate.
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            Research details available in Mandate&apos;s decision record.
          </p>
        )}
      </div>

      <div className="space-y-4 border-t border-white/8 pt-6">
        <h3 className="text-sm font-medium text-white">Research &amp; quality</h3>
        {hasResearch ? (
          <div className="space-y-3">
            {sessionContext.research.map((observation) => (
              <div
                key={`${observation.productId}-${observation.skuId ?? "all"}`}
                className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
              >
                <p className="text-sm text-slate-200">
                  Product research completed
                </p>
                <div className="mt-1 space-y-1 text-xs text-slate-400">
                  {observation.qualitySignal ? (
                    <p>Quality signal: {observation.qualitySignal}</p>
                  ) : null}
                  {observation.confidence != null ? (
                    <p>Evidence confidence: {observation.confidence.toFixed(2)}</p>
                  ) : null}
                  {observation.sourceType ? (
                    <p>Source: {observation.sourceType.replaceAll("_", " ")}</p>
                  ) : null}
                  {observation.evidenceIds.length > 0 ? (
                    <p>
                      Evidence references: {observation.evidenceIds.length} controlled
                      record{observation.evidenceIds.length === 1 ? "" : "s"}
                    </p>
                  ) : (
                    <p>No controlled evidence attached to this research pass.</p>
                  )}
                </div>
              </div>
            ))}
            {evidenceSummaries.map((summary) => (
              <p
                key={summary}
                className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-slate-300"
              >
                {summary}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            Research details available in Mandate&apos;s decision record.
          </p>
        )}
      </div>

      {hasIncentives ? (
        <div className="space-y-4 border-t border-white/8 pt-6">
          <h3 className="text-sm font-medium text-white">Incentives</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {voucherDecisions.length > 0 ? (
              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Voucher
                </p>
                <ul className="mt-2 space-y-2">
                  {voucherDecisions.map((item) => (
                    <li key={item.incentiveId} className="text-sm text-slate-300">
                      <span className="font-medium text-white">
                        {formatDecisionLabel(item.decision)}
                      </span>
                      {item.reason ? (
                        <span className="block text-xs text-slate-500">
                          {item.reason}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {loyaltyDecisions.length > 0 ? (
              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Loyalty
                </p>
                <ul className="mt-2 space-y-2">
                  {loyaltyDecisions.map((item) => (
                    <li key={item.incentiveId} className="text-sm text-slate-300">
                      <span className="font-medium text-white">
                        {formatDecisionLabel(item.decision)}
                      </span>
                      {item.reason ? (
                        <span className="block text-xs text-slate-500">
                          {item.reason}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </motion.section>
  );
}

export function buildSkuLabelsFromProducts(
  products: Array<{
    name: string;
    skus: Array<{
      sku_id: string;
      pack_quantity: number;
      pack_unit: string;
      sku_code: string;
    }>;
  }>,
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const product of products) {
    for (const sku of product.skus) {
      labels.set(
        sku.sku_id,
        `${sku.pack_quantity}-${sku.pack_unit} ${product.name}`,
      );
    }
  }
  return labels;
}

export function formatBasketItemLabel(
  basket: BasketView,
  skuLabels: Map<string, string>,
): string {
  return basket.items
    .map((item) => {
      const label = skuLabels.get(item.sku_id);
      if (label) {
        return `${item.quantity} × ${label}`;
      }
      return `${item.quantity} × SKU …${item.sku_id.slice(-8)}`;
    })
    .join(" · ");
}
