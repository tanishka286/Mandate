"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createShoppingIntent,
  createShoppingSession,
  fetchDemoToken,
  runSessionPlan,
} from "@/services/api-client";

const DEFAULT_MANDATE_A = "77777777-7777-4777-8777-777777777701";

export function DemoStartForm() {
  const router = useRouter();
  const [goalText, setGoalText] = useState("6 eggs");
  const [budgetRupees, setBudgetRupees] = useState("1000");
  const [mandateId, setMandateId] = useState(DEFAULT_MANDATE_A);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setError(null);
        const budgetMinor = Math.round(Number(budgetRupees) * 100);
        if (!Number.isFinite(budgetMinor) || budgetMinor < 0) {
          throw new Error("Budget must be a valid rupee amount.");
        }

        const auth = await fetchDemoToken();
        const token = auth.data.token;
        const session = await createShoppingSession(token);
        const intent = await createShoppingIntent(
          session.data.session_id,
          token,
          {
            goal_text: goalText.trim(),
            budget_minor: budgetMinor,
            category: "grocery",
            quality_preference: null,
            constraints: [],
            mandate_id: mandateId,
          },
        );
        const plan = await runSessionPlan(session.data.session_id, token, {
          intent_id: intent.data.intent_id,
        });
        if (plan.data.outcome !== "COMPLETED") {
          throw new Error(`Planning did not complete: ${plan.data.outcome}`);
        }

        const params = new URLSearchParams({
          sessionId: session.data.session_id,
          token,
          mandateId,
        });
        router.push(`/select?${params.toString()}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start session");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-slate-400">Grocery goal</span>
        <input
          required
          value={goalText}
          onChange={(event) => setGoalText(event.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white"
          placeholder="e.g. 6 eggs"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-slate-400">Planning budget (₹)</span>
        <input
          required
          inputMode="decimal"
          value={budgetRupees}
          onChange={(event) => setBudgetRupees(event.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-slate-400">Mandate</span>
        <select
          value={mandateId}
          onChange={(event) => setMandateId(event.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white"
        >
          <option value={DEFAULT_MANDATE_A}>Mandate A — ₹1000 ceiling</option>
          <option value="77777777-7777-4777-8777-777777777702">
            Mandate B — ₹800 ceiling
          </option>
        </select>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex w-fit items-center rounded-md bg-[var(--mandate-accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
      >
        {pending ? "Starting session…" : "Start authoritative shopping session"}
      </button>

      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-slate-500">
        Creates a real backend session, runs AI planning, then opens authoritative
        Best Value / Best Quality baskets. No client-side financial data.
      </p>
    </form>
  );
}
