"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type {
  BasketQuoteData,
  BasketSelectionData,
  BasketView,
  ProductDetail,
  SessionAuditEventView,
  SessionBasketsData,
} from "@mandate/types";
import {
  createBasketQuote,
  evaluatePolicy,
  fetchProductEvidence,
  fetchProductDetail,
  fetchSessionAudit,
  fetchSessionBaskets,
  selectBasket,
  type CheckoutResponseData,
  type PolicyEvaluateAllowData,
  type VerifyPaymentResult,
} from "@/services/api-client";
import { parseCombinationKey } from "@/lib/parse-combination-key";
import {
  buildSessionContextFromAudit,
  type SessionContextView,
} from "@/lib/session-context";
import { isPolicyDeniedError, type PolicyDenyDetails } from "@/lib/policy-errors";
import { basketTypeLabel, mandateLabelForId } from "@/lib/mandate-labels";
import { DemoJourneyIndicator } from "@/components/DemoJourneyIndicator";
import {
  MandateUnderstandingPanel,
  buildSkuLabelsFromProducts,
} from "@/components/select/MandateUnderstandingPanel";
import {
  BasketComparisonSection,
  RecommendationSection,
} from "@/components/select/BasketComparisonSection";
import {
  FreshQuotePanel,
  PolicyAuthorizationPanel,
  SelectionProgress,
  type SelectionFlowPhase,
} from "@/components/select/SelectionAuthorizationFlow";
import { OrderConfirmedPanel } from "@/components/payment/OrderConfirmedPanel";
import { DecisionTimelinePanel } from "@/components/payment/DecisionTimelinePanel";
import { TrustBoundaryPanel } from "@/components/payment/TrustBoundaryPanel";

export function BasketSelectionExperience(props: {
  sessionId?: string;
  token?: string;
  mandateId?: string;
  goalText?: string;
}) {
  const [data, setData] = useState<SessionBasketsData | null>(null);
  const [sessionContext, setSessionContext] = useState<SessionContextView | null>(
    null,
  );
  const [products, setProducts] = useState<ProductDetail[]>([]);
  const [evidenceSummaries, setEvidenceSummaries] = useState<string[]>([]);
  const [selection, setSelection] = useState<BasketSelectionData | null>(null);
  const [quote, setQuote] = useState<BasketQuoteData | null>(null);
  const [policyAllow, setPolicyAllow] = useState<PolicyEvaluateAllowData | null>(
    null,
  );
  const [policyDeny, setPolicyDeny] = useState<PolicyDenyDetails | null>(null);
  const [flowPhase, setFlowPhase] = useState<SelectionFlowPhase>("idle");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryApproved, setRecoveryApproved] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [denyCount, setDenyCount] = useState(0);
  const [auditEvents, setAuditEvents] = useState<SessionAuditEventView[]>([]);
  const [orderConfirmed, setOrderConfirmed] = useState<{
    verification: VerifyPaymentResult;
    checkout: CheckoutResponseData;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canCallApi = useMemo(
    () => Boolean(props.sessionId && props.token),
    [props.sessionId, props.token],
  );

  const skuLabels = useMemo(
    () => buildSkuLabelsFromProducts(products),
    [products],
  );

  const requirements = useMemo(() => {
    const key =
      data?.best_value?.combination_key ?? data?.best_quality?.combination_key ?? null;
    return parseCombinationKey(key);
  }, [data]);

  const recommendedId = data?.recommendation?.recommended_basket_id ?? null;
  const selectedId =
    selection?.basket_id ?? data?.active_selection?.basket_id ?? null;

  const selectedBasket = useMemo(() => {
    if (!data || !selectedId) {
      return null;
    }
    if (data.best_value?.basket_id === selectedId) {
      return data.best_value;
    }
    if (data.best_quality?.basket_id === selectedId) {
      return data.best_quality;
    }
    return null;
  }, [data, selectedId]);

  const selectedBasketLabel = basketTypeLabel(selectedBasket?.basket_type);

  const loadSession = useCallback(async () => {
    if (!props.sessionId || !props.token) {
      return;
    }

    const [basketsRes, auditRes] = await Promise.all([
      fetchSessionBaskets(props.sessionId, props.token),
      fetchSessionAudit(props.sessionId, props.token),
    ]);

    setData(basketsRes.data);
    setAuditEvents(auditRes.data.events);

    const context = buildSessionContextFromAudit(
      auditRes.data.events,
      props.goalText,
    );
    setSessionContext(context);

    const productIds = [
      ...new Set(context.research.map((item) => item.productId)),
    ];

    const loadedProducts: ProductDetail[] = [];
    const summaries: string[] = [];

    for (const productId of productIds) {
      try {
        const [productRes, evidenceRes] = await Promise.all([
          fetchProductDetail(productId),
          fetchProductEvidence(productId),
        ]);
        loadedProducts.push(productRes.data);
        for (const evidence of evidenceRes.data.evidence) {
          summaries.push(evidence.summary);
        }
      } catch {
        // Omit unavailable catalog/evidence lookups without fabricating data.
      }
    }

    setProducts(loadedProducts);
    setEvidenceSummaries(summaries);
  }, [props.goalText, props.sessionId, props.token]);

  useEffect(() => {
    if (!canCallApi) {
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        await loadSession();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load session");
      }
    });
  }, [canCallApi, loadSession]);

  const resetAuthorizationState = useCallback(() => {
    setSelection(null);
    setQuote(null);
    setPolicyAllow(null);
    setPolicyDeny(null);
    setFlowPhase("idle");
    setRecoveryApproved(false);
  }, []);

  const refreshAudit = useCallback(async () => {
    if (!props.sessionId || !props.token) {
      return;
    }
    try {
      const auditRes = await fetchSessionAudit(props.sessionId, props.token);
      setAuditEvents(auditRes.data.events);
    } catch {
      // Keep existing audit events if refresh fails.
    }
  }, [props.sessionId, props.token]);

  const onChoose = useCallback(
    (basket: BasketView, options?: { fromRecovery?: boolean }) => {
      if (!props.sessionId || !props.token || !props.mandateId) {
        setError("Authoritative session context is required.");
        return;
      }

      if (pending) {
        return;
      }

      const fromRecovery = options?.fromRecovery ?? false;

      startTransition(async () => {
        try {
          setError(null);
          setPolicyAllow(null);
          setPolicyDeny(null);
          setFlowPhase("selecting");
          if (fromRecovery) {
            setRecoveryMode(true);
          }

          const selected = await selectBasket(
            props.sessionId!,
            basket.basket_id,
            props.token!,
          );
          setSelection(selected.data);

          setFlowPhase("quoting");
          const quoted = await createBasketQuote(basket.basket_id, props.token!);
          setQuote(quoted.data);

          setFlowPhase("policy_checking");
          const policyRes = await evaluatePolicy(
            props.token!,
            crypto.randomUUID(),
            {
              mandate_id: props.mandateId!,
              basket_id: basket.basket_id,
              quote_version: quoted.data.quote_version,
            },
          );

          setPolicyAllow(policyRes.data);
          setPolicyDeny(null);
          setFlowPhase("authorized");
          setRecoveryMode(false);
          if (fromRecovery || denyCount > 0) {
            setRecoveryApproved(true);
          }
          await refreshAudit();
        } catch (err) {
          if (isPolicyDeniedError(err)) {
            setPolicyDeny(err.details);
            setPolicyAllow(null);
            setFlowPhase("denied");
            setRecoveryMode(false);
            setDenyCount((count) => count + 1);
            if (fromRecovery || denyCount > 0) {
              setRecoveryFailed(true);
            }
            await refreshAudit();
            return;
          }
          setFlowPhase("error");
          setRecoveryMode(false);
          setError(err instanceof Error ? err.message : "Selection failed");
        }
      });
    },
    [denyCount, pending, props.mandateId, props.sessionId, props.token, refreshAudit],
  );

  const onPaymentVerified = useCallback(
    async (result: {
      verification: VerifyPaymentResult;
      checkout: CheckoutResponseData;
    }) => {
      setOrderConfirmed(result);
      if (props.sessionId && props.token) {
        try {
          const auditRes = await fetchSessionAudit(props.sessionId, props.token);
          setAuditEvents(auditRes.data.events);
        } catch {
          // Keep existing audit events if refresh fails.
        }
      }
    },
    [props.sessionId, props.token],
  );

  const onChooseAlternative = useCallback(() => {
    if (!data || !selection || recoveryFailed) {
      return;
    }

    const alternative =
      data.best_value?.basket_id === selection.basket_id
        ? data.best_quality
        : data.best_value;

    setPolicyAllow(null);
    setPolicyDeny(null);
    setRecoveryApproved(false);
    if (alternative) {
      onChoose(alternative, { fromRecovery: true });
    }
  }, [data, onChoose, recoveryFailed, selection]);

  const onReturnToComparison = useCallback(() => {
    resetAuthorizationState();
    setRecoveryFailed(false);
    setRecoveryMode(false);
    setDenyCount(0);
    setError(null);
  }, [resetAuthorizationState]);

  const onPolicyDeniedAtCheckout = useCallback(
    (details: PolicyDenyDetails) => {
      setPolicyAllow(null);
      setPolicyDeny(details);
      setFlowPhase("denied");
      setDenyCount((count) => count + 1);
      void refreshAudit();
    },
    [refreshAudit],
  );

  const journeyStep = orderConfirmed
    ? "confirm"
    : policyAllow
      ? "pay"
      : flowPhase === "selecting" ||
          flowPhase === "quoting" ||
          flowPhase === "policy_checking" ||
          policyDeny
        ? "authorize"
        : "compare";

  if (!canCallApi) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-16 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          Authoritative session required
        </h1>
        <p className="text-slate-300">
          Basket selection requires a real shopping session created by the backend.
          Financial amounts must come from server quotes only.
        </p>
        <Link
          href="/"
          className="inline-flex w-fit rounded-xl bg-[var(--mandate-accent)] px-5 py-3 text-sm font-medium text-white"
        >
          Start a new shopping session
        </Link>
      </div>
    );
  }

  if (!data && !error) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16 text-slate-300 sm:px-8">
        Loading authoritative session baskets…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
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
    <div className="relative min-h-screen overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[24rem] bg-[radial-gradient(ellipse_at_top,rgba(61,139,110,0.12),transparent_65%)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
        <header className="space-y-3">
          <DemoJourneyIndicator currentStep={journeyStep} />
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
            Mandate
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {orderConfirmed ? "Purchase complete" : "Choose your basket"}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            {orderConfirmed
              ? "Your payment was verified server-side and your order is confirmed."
              : "Review what Mandate understood, compare Best Value and Best Quality, then authorize a fresh server-side quote against your spending mandate."}
          </p>
        </header>

        {orderConfirmed ? (
          <>
            <OrderConfirmedPanel
              basketLabel={selectedBasketLabel}
              mandateLabel={mandateLabelForId(props.mandateId)}
              verification={orderConfirmed.verification}
              orderId={orderConfirmed.checkout.order_id}
            />
            <DecisionTimelinePanel
              events={auditEvents}
              goalText={props.goalText}
              defaultExpanded
            />
            <TrustBoundaryPanel />
            <div className="flex justify-center pt-2">
              <Link
                href="/"
                className="inline-flex rounded-xl border border-white/15 px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                Start a new shopping session
              </Link>
            </div>
          </>
        ) : (
          <>
        {sessionContext ? (
          <MandateUnderstandingPanel
            sessionContext={sessionContext}
            requirements={requirements}
            evidenceSummaries={evidenceSummaries}
            skuLabels={skuLabels}
          />
        ) : null}

        <BasketComparisonSection
          data={data}
          recommendedId={recommendedId}
          selectedId={selectedId}
          disabled={pending || Boolean(policyAllow)}
          skuLabels={skuLabels}
          onChoose={(basket) => onChoose(basket)}
        />

        <RecommendationSection recommendation={data.recommendation} />

        <SelectionProgress phase={flowPhase} recoveryMode={recoveryMode} />

        {quote && flowPhase !== "idle" ? <FreshQuotePanel quote={quote} /> : null}

        <PolicyAuthorizationPanel
          allow={policyAllow}
          deny={policyDeny}
          mandateId={props.mandateId}
          token={props.token}
          selection={selection}
          quote={quote}
          basketLabel={selectedBasketLabel}
          recoveryApproved={recoveryApproved}
          recoveryFailed={recoveryFailed}
          onPaymentVerified={onPaymentVerified}
          onChooseAlternative={
            policyDeny?.recoverable && !recoveryFailed
              ? onChooseAlternative
              : undefined
          }
          onReturnToComparison={
            policyDeny ? onReturnToComparison : undefined
          }
          onPolicyDeniedAtCheckout={onPolicyDeniedAtCheckout}
        />

        {error ? (
          <div
            className="rounded-xl border border-red-400/25 bg-red-950/30 px-4 py-3 text-sm text-red-200"
            role="alert"
          >
            <p>{error}</p>
            {selection && quote && !policyDeny ? (
              <button
                type="button"
                onClick={() => {
                  const basket =
                    data.best_value?.basket_id === selection.basket_id
                      ? data.best_value
                      : data.best_quality;
                  if (basket) {
                    onChoose(basket);
                  }
                }}
                className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        <TrustBoundaryPanel />
          </>
        )}
      </div>
    </div>
  );
}
