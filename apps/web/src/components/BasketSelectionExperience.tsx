"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  BasketQuoteData,
  BasketSelectionData,
  BasketView,
  SessionBasketsData,
} from "@mandate/types";
import {
  createBasketQuote,
  fetchSessionBaskets,
  selectBasket,
} from "@/services/api-client";
import { CheckoutPaymentPanel } from "@/components/CheckoutPaymentPanel";

function formatInr(minor: number): string {
  const rupees = (minor / 100).toFixed(2);
  return `₹${rupees}`;
}

const DEMO_BASKETS: SessionBasketsData = {
  session_id: "00000000-0000-4000-8000-000000000001",
  optimization_run_id: "00000000-0000-4000-8000-000000000002",
  best_value: {
    basket_id: "11111111-1111-4111-8111-111111111101",
    optimization_run_id: "00000000-0000-4000-8000-000000000002",
    session_id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000099",
    basket_type: "BEST_VALUE",
    status: "CURRENT",
    gross_amount_minor: 92000,
    discount_amount_minor: 4600,
    final_payable_minor: 87400,
    currency: "INR",
    quality_summary: "Good quality across staples",
    recommendation_reason: null,
    explanation:
      "Lowest practical cost while meeting quantity and pack constraints.",
    combination_key: "demo-value",
    state_version: 1,
    items: [
      {
        basket_item_id: "21111111-1111-4111-8111-111111111101",
        basket_id: "11111111-1111-4111-8111-111111111101",
        requirement_id: null,
        sku_id: "33333333-3333-4333-8333-333333333301",
        quantity: 2,
        unit_price_minor: 25000,
        line_amount_minor: 50000,
        quality_level: "GOOD",
        evidence_refs_json: [],
        created_at: "2026-09-05T00:00:00.000Z",
        updated_at: "2026-09-05T00:00:00.000Z",
      },
      {
        basket_item_id: "21111111-1111-4111-8111-111111111102",
        basket_id: "11111111-1111-4111-8111-111111111101",
        requirement_id: null,
        sku_id: "33333333-3333-4333-8333-333333333302",
        quantity: 1,
        unit_price_minor: 42000,
        line_amount_minor: 42000,
        quality_level: "FAIR",
        evidence_refs_json: [],
        created_at: "2026-09-05T00:00:00.000Z",
        updated_at: "2026-09-05T00:00:00.000Z",
      },
    ],
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
  },
  best_quality: {
    basket_id: "11111111-1111-4111-8111-111111111102",
    optimization_run_id: "00000000-0000-4000-8000-000000000002",
    session_id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000099",
    basket_type: "BEST_QUALITY",
    status: "CURRENT",
    gross_amount_minor: 98000,
    discount_amount_minor: 2000,
    final_payable_minor: 96000,
    currency: "INR",
    quality_summary: "Higher evidence-backed quality within budget",
    recommendation_reason: null,
    explanation:
      "Slightly higher cost for stronger quality evidence on key items.",
    combination_key: "demo-quality",
    state_version: 1,
    items: [
      {
        basket_item_id: "21111111-1111-4111-8111-111111111201",
        basket_id: "11111111-1111-4111-8111-111111111102",
        requirement_id: null,
        sku_id: "33333333-3333-4333-8333-333333333303",
        quantity: 3,
        unit_price_minor: 22000,
        line_amount_minor: 66000,
        quality_level: "EXCELLENT",
        evidence_refs_json: [],
        created_at: "2026-09-05T00:00:00.000Z",
        updated_at: "2026-09-05T00:00:00.000Z",
      },
      {
        basket_item_id: "21111111-1111-4111-8111-111111111202",
        basket_id: "11111111-1111-4111-8111-111111111102",
        requirement_id: null,
        sku_id: "33333333-3333-4333-8333-333333333304",
        quantity: 1,
        unit_price_minor: 32000,
        line_amount_minor: 32000,
        quality_level: "GOOD",
        evidence_refs_json: [],
        created_at: "2026-09-05T00:00:00.000Z",
        updated_at: "2026-09-05T00:00:00.000Z",
      },
    ],
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
  },
  recommendation: {
    recommended_basket_type: "BEST_VALUE",
    recommended_basket_id: "11111111-1111-4111-8111-111111111101",
    reason: "Best balance of cost and fulfillment for this goal.",
    tradeoff_summary:
      "Best Quality costs about ₹86 more for a clear quality uplift.",
    user_may_select_alternative: true,
  },
  active_selection: null,
};

function BasketOption(props: {
  basket: BasketView;
  recommended: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { basket, recommended, selected, disabled, onSelect } = props;
  const title =
    basket.basket_type === "BEST_VALUE" ? "Best Value" : "Best Quality";

  return (
    <article
      className={[
        "flex flex-col gap-4 rounded-lg border p-5 transition",
        selected
          ? "border-[var(--mandate-accent)] bg-[rgba(61,139,110,0.12)]"
          : "border-white/10 bg-black/20",
        recommended ? "ring-1 ring-[var(--mandate-accent)]/50" : "",
      ].join(" ")}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {recommended ? (
            <p className="mt-1 text-sm text-[var(--mandate-accent)]">
              AI recommendation — guidance only
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-400">Alternative option</p>
          )}
        </div>
        <p className="text-right text-2xl font-semibold tabular-nums">
          {formatInr(basket.final_payable_minor)}
        </p>
      </header>

      <dl className="grid grid-cols-3 gap-2 text-sm text-slate-300">
        <div>
          <dt className="text-slate-500">Gross</dt>
          <dd className="tabular-nums">{formatInr(basket.gross_amount_minor)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Discount</dt>
          <dd className="tabular-nums">
            {formatInr(basket.discount_amount_minor)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Payable</dt>
          <dd className="tabular-nums">
            {formatInr(basket.final_payable_minor)}
          </dd>
        </div>
      </dl>

      {basket.quality_summary ? (
        <p className="text-sm text-slate-300">
          <span className="text-slate-500">Quality: </span>
          {basket.quality_summary}
        </p>
      ) : null}

      {basket.explanation ? (
        <p className="text-sm leading-relaxed text-slate-400">
          {basket.explanation}
        </p>
      ) : null}

      <ul className="space-y-2 border-t border-white/10 pt-3 text-sm">
        {basket.items.map((item) => (
          <li
            key={item.basket_item_id}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="text-slate-300">
              SKU {item.sku_id.slice(0, 8)}… × {item.quantity}
              {item.quality_level ? (
                <span className="text-slate-500"> · {item.quality_level}</span>
              ) : null}
            </span>
            <span className="tabular-nums text-slate-200">
              {formatInr(item.line_amount_minor)}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className={[
          "mt-auto rounded-md px-4 py-2.5 text-sm font-medium transition",
          selected
            ? "bg-[var(--mandate-accent)] text-white"
            : "bg-white/10 text-white hover:bg-white/15",
          disabled ? "cursor-not-allowed opacity-50" : "",
        ].join(" ")}
      >
        {selected ? "Selected" : `Choose ${title}`}
      </button>
    </article>
  );
}

export function BasketSelectionExperience(props: {
  initialData?: SessionBasketsData;
  sessionId?: string;
  token?: string;
  mandateId?: string;
}) {
  const [data, setData] = useState<SessionBasketsData>(
    props.initialData ?? DEMO_BASKETS,
  );
  const [selection, setSelection] = useState<BasketSelectionData | null>(null);
  const [quote, setQuote] = useState<BasketQuoteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [liveMode, setLiveMode] = useState(false);

  const recommendedId = data.recommendation?.recommended_basket_id ?? null;
  const selectedId =
    selection?.basket_id ?? data.active_selection?.basket_id ?? null;

  const canCallApi = useMemo(
    () => Boolean(props.sessionId && props.token),
    [props.sessionId, props.token],
  );

  function loadLive() {
    if (!props.sessionId || !props.token) {
      setError("Session id and auth token are required for live baskets.");
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        const res = await fetchSessionBaskets(props.sessionId!, props.token!);
        setData(res.data);
        setLiveMode(true);
        setSelection(null);
        setQuote(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load baskets");
      }
    });
  }

  function onChoose(basket: BasketView) {
    startTransition(async () => {
      try {
        setError(null);
        setQuote(null);

        if (liveMode && props.sessionId && props.token) {
          const selected = await selectBasket(
            props.sessionId,
            basket.basket_id,
            props.token,
          );
          setSelection(selected.data);
          const quoted = await createBasketQuote(
            basket.basket_id,
            props.token,
          );
          setQuote(quoted.data);
          return;
        }

        // Demo path: local preference only — never pretends to authorize.
        setSelection({
          selection_id: "demo-selection",
          session_id: data.session_id,
          basket_id: basket.basket_id,
          selection_source: "USER",
          status: "SELECTED",
          selected_at: new Date().toISOString(),
          superseded_at: null,
          created_at: new Date().toISOString(),
          order_created: false,
          payment_created: false,
          policy_decision: null,
        });
        setQuote(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Selection failed");
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--mandate-accent)]">
          Phase 7 · Selection
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">Mandate</h1>
        <p className="max-w-2xl text-slate-300">
          Choose Best Value or Best Quality. The recommendation is guidance
          only — payment still requires a fresh server quote and policy ALLOW.
        </p>
      </header>

      {data.recommendation ? (
        <section className="rounded-lg border border-white/10 bg-gradient-to-br from-[rgba(61,139,110,0.18)] to-transparent p-5">
          <h2 className="text-lg font-medium">AI recommendation</h2>
          <p className="mt-2 text-slate-200">
            {data.recommendation.reason ??
              "A basket is recommended based on cost and quality trade-offs."}
          </p>
          {data.recommendation.tradeoff_summary ? (
            <p className="mt-2 text-sm text-slate-400">
              {data.recommendation.tradeoff_summary}
            </p>
          ) : null}
          <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">
            You can still choose the alternative · recommendation never disables
            a basket
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        {data.best_value ? (
          <BasketOption
            basket={data.best_value}
            recommended={recommendedId === data.best_value.basket_id}
            selected={selectedId === data.best_value.basket_id}
            disabled={pending}
            onSelect={() => onChoose(data.best_value!)}
          />
        ) : null}
        {data.best_quality ? (
          <BasketOption
            basket={data.best_quality}
            recommended={recommendedId === data.best_quality.basket_id}
            selected={selectedId === data.best_quality.basket_id}
            disabled={pending}
            onSelect={() => onChoose(data.best_quality!)}
          />
        ) : null}
      </section>

      {selection ? (
        <section className="space-y-2 rounded-lg border border-white/10 p-4 text-sm">
          <h3 className="font-medium">Selection recorded</h3>
          <p className="text-slate-400">
            selection_id {selection.selection_id} · preference only ·{" "}
            <span className="text-[var(--mandate-accent)]">
              no order · no payment · no policy ALLOW
            </span>
          </p>
        </section>
      ) : null}

      {quote ? (
        <section className="space-y-3 rounded-lg border border-[var(--mandate-accent)]/40 bg-black/30 p-4">
          <h3 className="font-medium">Fresh authoritative quote</h3>
          <p className="text-sm text-slate-400">
            quote_version {quote.quote_version} · amounts from current
            catalog/stock/incentives
          </p>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Gross</dt>
              <dd className="tabular-nums text-lg">
                {formatInr(quote.gross_amount_minor)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Discount</dt>
              <dd className="tabular-nums text-lg">
                {formatInr(quote.discount_amount_minor)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Final payable</dt>
              <dd className="tabular-nums text-lg font-semibold">
                {formatInr(quote.final_payable_minor)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-slate-500">
            Policy must evaluate this quote_version before checkout.
          </p>
          {canCallApi && props.mandateId && selection ? (
            <CheckoutPaymentPanel
              token={props.token!}
              mandateId={props.mandateId}
              selection={selection}
              quote={quote}
            />
          ) : canCallApi && !props.mandateId ? (
            <p className="text-xs text-amber-300">
              Pass mandateId (query param or prop) to enable Test Mode checkout.
            </p>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-6 text-sm text-slate-400">
        <span>{liveMode ? "Live API session" : "Demo baskets (local)"}</span>
        {canCallApi ? (
          <button
            type="button"
            onClick={loadLive}
            disabled={pending}
            className="rounded-md bg-white/10 px-3 py-1.5 text-white hover:bg-white/15"
          >
            Load live session baskets
          </button>
        ) : (
          <span>
            Pass sessionId + token props to enable live API selection and quote.
          </span>
        )}
      </footer>
    </div>
  );
}
