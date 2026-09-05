"use client";

import type { BasketView, SessionBasketsData } from "@mandate/types";
import { motion, useReducedMotion } from "framer-motion";
import { formatInr } from "@/lib/format-inr";
import {
  formatBasketItemLabel,
} from "@/components/select/MandateUnderstandingPanel";
import type { buildSkuLabelsFromProducts } from "@/components/select/MandateUnderstandingPanel";

type SkuLabelMap = ReturnType<typeof buildSkuLabelsFromProducts>;

function humanizeExplanation(explanation: string | null): string[] {
  if (!explanation) {
    return [];
  }
  return explanation
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replaceAll("_", " ").toLowerCase());
}

function BasketComparisonCard(props: {
  basket: BasketView;
  recommended: boolean;
  selected: boolean;
  disabled: boolean;
  skuLabels: SkuLabelMap;
  onSelect: () => void;
}) {
  const { basket, recommended, selected, disabled, skuLabels, onSelect } = props;
  const isValue = basket.basket_type === "BEST_VALUE";
  const title = isValue ? "Best Value" : "Best Quality";
  const subtitle = isValue
    ? "Lowest practical cost"
    : "Highest practical quality within budget";
  const checks = humanizeExplanation(basket.explanation);

  return (
    <article
      className={[
        "flex h-full flex-col gap-5 rounded-2xl border p-6 transition",
        selected
          ? "border-[var(--mandate-accent)] bg-[rgba(61,139,110,0.12)] ring-1 ring-[var(--mandate-accent)]/40"
          : "border-white/10 bg-black/20",
        recommended && !selected ? "ring-1 ring-[var(--mandate-accent)]/30" : "",
      ].join(" ")}
    >
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--mandate-accent)]">
              {title}
            </p>
            <h3 className="mt-1 text-2xl font-semibold text-white">{subtitle}</h3>
          </div>
          {recommended ? (
            <span className="rounded-full border border-[var(--mandate-accent)]/30 bg-[var(--mandate-accent)]/10 px-2.5 py-1 text-xs text-[var(--mandate-accent)]">
              Recommended
            </span>
          ) : null}
        </div>
        <p className="text-3xl font-semibold tabular-nums text-white">
          {formatInr(basket.final_payable_minor, { compact: true })}
        </p>
        <p className="text-sm text-slate-400">
          {formatBasketItemLabel(basket, skuLabels)}
        </p>
      </header>

      <ul className="space-y-2 text-sm text-slate-300">
        {checks.length > 0 ? (
          checks.slice(0, 4).map((check) => (
            <li key={check} className="flex gap-2">
              <span className="text-[var(--mandate-accent)]" aria-hidden="true">
                ✓
              </span>
              <span className="capitalize">{check}</span>
            </li>
          ))
        ) : (
          <>
            <li className="flex gap-2">
              <span className="text-[var(--mandate-accent)]" aria-hidden="true">
                ✓
              </span>
              <span>Requirement satisfied</span>
            </li>
            {basket.quality_summary ? (
              <li className="flex gap-2">
                <span className="text-[var(--mandate-accent)]" aria-hidden="true">
                  ✓
                </span>
                <span>Quality: {basket.quality_summary}</span>
              </li>
            ) : null}
          </>
        )}
        {basket.discount_amount_minor > 0 ? (
          <li className="flex gap-2">
            <span className="text-[var(--mandate-accent)]" aria-hidden="true">
              ✓
            </span>
            <span>
              Incentive treatment applied ({formatInr(basket.discount_amount_minor, { compact: true })} off)
            </span>
          </li>
        ) : null}
      </ul>

      <dl className="grid grid-cols-3 gap-2 border-t border-white/8 pt-4 text-xs text-slate-400">
        <div>
          <dt>Gross</dt>
          <dd className="mt-1 tabular-nums text-slate-200">
            {formatInr(basket.gross_amount_minor, { compact: true })}
          </dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd className="mt-1 tabular-nums text-slate-200">
            {formatInr(basket.discount_amount_minor, { compact: true })}
          </dd>
        </div>
        <div>
          <dt>Payable</dt>
          <dd className="mt-1 tabular-nums text-slate-200">
            {formatInr(basket.final_payable_minor, { compact: true })}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className={[
          "mt-auto inline-flex w-full items-center justify-center rounded-xl px-5 py-3.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mandate-accent)]/50",
          selected
            ? "bg-[var(--mandate-accent)] text-white"
            : "bg-white/10 text-white hover:bg-white/15",
          disabled ? "cursor-not-allowed opacity-50" : "",
        ].join(" ")}
      >
        {selected ? `${title} selected` : `Choose ${title}`}
      </button>
    </article>
  );
}

export function BasketComparisonSection(props: {
  data: SessionBasketsData;
  recommendedId: string | null;
  selectedId: string | null;
  disabled: boolean;
  skuLabels: SkuLabelMap;
  onChoose: (basket: BasketView) => void;
}) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const motionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, ease: "easeOut" as const },
      };

  return (
    <motion.section {...motionProps} className="space-y-5">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
          Your options
        </p>
        <h2 className="text-xl font-medium text-white sm:text-2xl">
          Best Value vs Best Quality
        </h2>
        <p className="text-sm text-slate-400">
          Both baskets are feasible. Mandate preserves your right to choose either
          option — recommendation is guidance, not authorization.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {props.data.best_value ? (
          <BasketComparisonCard
            basket={props.data.best_value}
            recommended={props.recommendedId === props.data.best_value.basket_id}
            selected={props.selectedId === props.data.best_value.basket_id}
            disabled={props.disabled}
            skuLabels={props.skuLabels}
            onSelect={() => props.onChoose(props.data.best_value!)}
          />
        ) : null}
        {props.data.best_quality ? (
          <BasketComparisonCard
            basket={props.data.best_quality}
            recommended={props.recommendedId === props.data.best_quality.basket_id}
            selected={props.selectedId === props.data.best_quality.basket_id}
            disabled={props.disabled}
            skuLabels={props.skuLabels}
            onSelect={() => props.onChoose(props.data.best_quality!)}
          />
        ) : null}
      </div>
    </motion.section>
  );
}

export function RecommendationSection(props: {
  recommendation: SessionBasketsData["recommendation"];
}) {
  const { recommendation } = props;
  if (!recommendation?.recommended_basket_type) {
    return null;
  }

  const label =
    recommendation.recommended_basket_type === "BEST_VALUE"
      ? "Best Value"
      : "Best Quality";

  return (
    <section className="rounded-2xl border border-[var(--mandate-accent)]/25 bg-gradient-to-br from-[rgba(61,139,110,0.16)] to-transparent p-6 sm:p-8">
      <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
        AI recommendation
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-white">
        Mandate recommends {label}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-200">
        <span className="font-medium text-white">Why: </span>
        {recommendation.reason ??
          "A basket is recommended based on cost and quality trade-offs recorded by the backend."}
      </p>
      {recommendation.tradeoff_summary ? (
        <p className="mt-2 text-xs text-slate-400">{recommendation.tradeoff_summary}</p>
      ) : null}
      <p className="mt-4 text-xs text-slate-500">
        Guidance only — you may still choose the alternative basket.
      </p>
    </section>
  );
}
