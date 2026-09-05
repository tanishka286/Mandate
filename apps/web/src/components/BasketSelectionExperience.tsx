"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
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
import { AuditTrailPanel } from "@/components/AuditTrailPanel";

function formatInr(minor: number): string {
  const rupees = (minor / 100).toFixed(2);
  return `₹${rupees}`;
}

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
  sessionId?: string;
  token?: string;
  mandateId?: string;
}) {
  const [data, setData] = useState<SessionBasketsData | null>(null);
  const [selection, setSelection] = useState<BasketSelectionData | null>(null);
  const [quote, setQuote] = useState<BasketQuoteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canCallApi = useMemo(
    () => Boolean(props.sessionId && props.token),
    [props.sessionId, props.token],
  );

  useEffect(() => {
    if (!props.sessionId || !props.token) {
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        const res = await fetchSessionBaskets(props.sessionId!, props.token!);
        setData(res.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load baskets");
      }
    });
  }, [props.sessionId, props.token]);

  const recommendedId = data?.recommendation?.recommended_basket_id ?? null;
  const selectedId =
    selection?.basket_id ?? data?.active_selection?.basket_id ?? null;

  function onChoose(basket: BasketView) {
    if (!props.sessionId || !props.token) {
      setError("Authoritative session context is required.");
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        setQuote(null);
        const selected = await selectBasket(
          props.sessionId!,
          basket.basket_id,
          props.token!,
        );
        setSelection(selected.data);
        const quoted = await createBasketQuote(basket.basket_id, props.token!);
        setQuote(quoted.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Selection failed");
      }
    });
  }

  if (!canCallApi) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">
          Authoritative session required
        </h1>
        <p className="text-slate-300">
          Basket selection and checkout require a real shopping session created by
          the backend. Demo baskets are not shown here because financial amounts
          must come from server quotes only.
        </p>
        <Link
          href="/"
          className="inline-flex w-fit rounded-md bg-[var(--mandate-accent)] px-4 py-2.5 text-sm font-medium text-white"
        >
          Start a new shopping session
        </Link>
      </div>
    );
  }

  if (!data && !error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-slate-300">
        Loading authoritative session baskets…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-red-300" role="alert">
          {error ?? "Failed to load session baskets."}
        </p>
        <Link href="/" className="mt-4 inline-block text-[var(--mandate-accent)]">
          Return home
        </Link>
      </div>
    );
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
        <p className="text-xs text-slate-500">
          Live API session {data.session_id}
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
          {props.mandateId && selection ? (
            <CheckoutPaymentPanel
              token={props.token!}
              mandateId={props.mandateId}
              selection={selection}
              quote={quote}
            />
          ) : (
            <p className="text-xs text-amber-300">
              mandateId is required to enable Test Mode checkout.
            </p>
          )}
        </section>
      ) : null}

      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {props.sessionId && props.token ? (
        <AuditTrailPanel sessionId={props.sessionId} token={props.token} />
      ) : null}
    </div>
  );
}
