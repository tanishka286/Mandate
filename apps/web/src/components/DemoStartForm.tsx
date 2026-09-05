"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createShoppingIntent,
  createShoppingSession,
  fetchDemoToken,
  runSessionPlan,
} from "@/services/api-client";
import { formatBudgetRupeesDisplay } from "@/lib/format-budget";
import {
  toUserFacingStartError,
  validateBudgetRupees,
  validateGoal,
} from "@/lib/start-session-errors";
import {
  PlanningErrorState,
  PlanningLoadingState,
  type PlanningSummary,
  type StartSessionPhase,
} from "@/components/PlanningLoadingState";
import { DemoJourneyIndicator } from "@/components/DemoJourneyIndicator";

const DEFAULT_MANDATE_A = "77777777-7777-4777-8777-777777777701";
const DEFAULT_MANDATE_B = "77777777-7777-4777-8777-777777777702";

const MANDATE_OPTIONS = [
  {
    id: DEFAULT_MANDATE_A,
    label: "Mandate A",
    ceiling: "₹1,000 spending ceiling",
  },
  {
    id: DEFAULT_MANDATE_B,
    label: "Mandate B",
    ceiling: "₹800 spending ceiling",
  },
] as const;

const EXAMPLE_PROMPTS = [
  "6 eggs",
  "Breakfast for 5 people",
  "Ingredients for dinner for 4",
] as const;

const COMPLETION_NAV_DELAY_MS = 450;

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white placeholder:text-slate-500 transition focus:border-[var(--mandate-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--mandate-accent)]/25 disabled:cursor-not-allowed disabled:opacity-60";

type FlowView = "form" | "planning" | "error";

function buildPlanningSummary(
  goalText: string,
  budgetRupees: string,
  mandateId: string,
): PlanningSummary {
  const mandate = MANDATE_OPTIONS.find((option) => option.id === mandateId);
  return {
    goalText: goalText.trim(),
    budgetDisplay: formatBudgetRupeesDisplay(budgetRupees),
    mandateLabel: mandate?.label ?? "Spending mandate",
    mandateCeiling: mandate?.ceiling ?? "",
  };
}

export function DemoStartForm() {
  const router = useRouter();
  const [goalText, setGoalText] = useState("");
  const [budgetRupees, setBudgetRupees] = useState("1000");
  const [mandateId, setMandateId] = useState(DEFAULT_MANDATE_A);
  const [error, setError] = useState<string | null>(null);
  const [flowView, setFlowView] = useState<FlowView>("form");
  const [phase, setPhase] = useState<StartSessionPhase>("token");
  const [planningSummary, setPlanningSummary] = useState<PlanningSummary | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const runPlanningFlow = useCallback(() => {
    const goalError = validateGoal(goalText);
    if (goalError) {
      setError(goalError);
      setFlowView("form");
      return;
    }

    const { budgetMinor, error: budgetError } = validateBudgetRupees(budgetRupees);
    if (budgetError) {
      setError(budgetError);
      setFlowView("form");
      return;
    }

    const summary = buildPlanningSummary(goalText, budgetRupees, mandateId);
    setPlanningSummary(summary);
    setError(null);
    setFlowView("planning");
    setPhase("token");

    startTransition(async () => {
      try {
        const auth = await fetchDemoToken();
        const token = auth.data.token;

        setPhase("session");
        const session = await createShoppingSession(token);

        setPhase("intent");
        const intent = await createShoppingIntent(
          session.data.session_id,
          token,
          {
            goal_text: summary.goalText,
            budget_minor: budgetMinor,
            category: "grocery",
            quality_preference: null,
            constraints: [],
            mandate_id: mandateId,
          },
        );

        setPhase("planning");
        const plan = await runSessionPlan(session.data.session_id, token, {
          intent_id: intent.data.intent_id,
        });

        if (plan.data.outcome !== "COMPLETED") {
          throw new Error(`Planning did not complete: ${plan.data.outcome}`);
        }

        setPhase("completed");

        const params = new URLSearchParams({
          sessionId: session.data.session_id,
          token,
          mandateId,
          goalText: summary.goalText,
        });

        window.setTimeout(() => {
          router.push(`/select?${params.toString()}`);
        }, COMPLETION_NAV_DELAY_MS);
      } catch (err) {
        setError(toUserFacingStartError(err));
        setFlowView("error");
      }
    });
  }, [budgetRupees, goalText, mandateId, router]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runPlanningFlow();
  }

  function applyExamplePrompt(prompt: string) {
    setGoalText(prompt);
    setError(null);
  }

  function handleRetry() {
    setError(null);
    runPlanningFlow();
  }

  if (flowView === "planning" && planningSummary) {
    return (
      <div className="space-y-4">
        <DemoJourneyIndicator currentStep="understand" />
        <PlanningLoadingState phase={phase} summary={planningSummary} />
      </div>
    );
  }

  if (flowView === "error" && planningSummary && error) {
    return (
      <div className="space-y-4">
        <DemoJourneyIndicator currentStep="understand" />
        <PlanningErrorState
          summary={planningSummary}
          message={error}
          onRetry={handleRetry}
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-white/10 bg-black/20 p-6 shadow-xl shadow-black/20 sm:p-8"
      noValidate
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="goal-text" className="block text-sm font-medium text-slate-200">
            What do you need?
          </label>
          <textarea
            id="goal-text"
            required
            rows={3}
            value={goalText}
            onChange={(event) => {
              setGoalText(event.target.value);
              if (error) setError(null);
            }}
            className={`${inputClassName} min-h-[6.5rem] resize-y`}
            placeholder="I need groceries for a pasta dinner for 4 people"
            disabled={pending}
            aria-describedby="goal-examples"
          />
          <div id="goal-examples" className="flex flex-wrap gap-2 pt-1">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => applyExamplePrompt(prompt)}
                disabled={pending}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:border-[var(--mandate-accent)]/40 hover:bg-[var(--mandate-accent)]/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mandate-accent)]/40 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="budget" className="block text-sm font-medium text-slate-200">
            Budget
          </label>
          <div className="relative">
            <span
              className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400"
              aria-hidden="true"
            >
              ₹
            </span>
            <input
              id="budget"
              required
              inputMode="decimal"
              value={budgetRupees}
              onChange={(event) => {
                setBudgetRupees(event.target.value);
                if (error) setError(null);
              }}
              className={`${inputClassName} pl-9 tabular-nums`}
              placeholder="1,000"
              disabled={pending}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="mandate" className="block text-sm font-medium text-slate-200">
            Spending mandate
          </label>
          <select
            id="mandate"
            value={mandateId}
            onChange={(event) => setMandateId(event.target.value)}
            className={inputClassName}
            disabled={pending}
          >
            {MANDATE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.ceiling}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">
            Policy authorizes payment against your selected mandate — not the planning budget alone.
          </p>
        </div>
      </div>

      {error ? (
        <div
          className="mt-6 rounded-xl border border-red-400/25 bg-red-950/30 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-2 text-sm font-medium text-red-100 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300/50"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--mandate-accent)] px-5 py-3.5 text-base font-medium text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mandate-accent)]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mandate-bg)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        Start planning
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
