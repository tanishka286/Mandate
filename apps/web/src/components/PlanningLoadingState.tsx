"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export type StartSessionPhase =
  | "token"
  | "session"
  | "intent"
  | "planning"
  | "completed";

export interface PlanningSummary {
  goalText: string;
  budgetDisplay: string;
  mandateLabel: string;
  mandateCeiling: string;
}

type StageStatus = "pending" | "active" | "complete";

interface PlanningStage {
  id: string;
  title: string;
  detail: string;
}

const PLANNING_STAGES: PlanningStage[] = [
  {
    id: "understand",
    title: "Understanding your goal",
    detail: "",
  },
  {
    id: "requirements",
    title: "Building requirements",
    detail: "Identifying the items you need",
  },
  {
    id: "research",
    title: "Researching options",
    detail: "Comparing available products",
  },
  {
    id: "optimize",
    title: "Optimizing the basket",
    detail: "Finding the best value and quality options",
  },
  {
    id: "prepare",
    title: "Preparing recommendations",
    detail: "Best Value and Best Quality",
  },
  {
    id: "ready",
    title: "Ready for your choice",
    detail: "Opening your basket options",
  },
];

function resolveStageStatuses(
  phase: StartSessionPhase,
  planningPulse: number,
): StageStatus[] {
  const statuses: StageStatus[] = PLANNING_STAGES.map(() => "pending");

  if (phase === "token" || phase === "session") {
    statuses[0] = "active";
    return statuses;
  }

  if (phase === "intent") {
    statuses[0] = "complete";
    statuses[1] = "active";
    return statuses;
  }

  if (phase === "planning") {
    statuses[0] = "complete";
    statuses[1] = "complete";
    const activeIndex = 2 + (planningPulse % 3);
    for (let index = 2; index < PLANNING_STAGES.length; index += 1) {
      statuses[index] = index === activeIndex ? "active" : "pending";
    }
    return statuses;
  }

  return PLANNING_STAGES.map(() => "complete");
}

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "complete") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--mandate-accent)]/20 text-[var(--mandate-accent)]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
          <path
            d="M3.5 8.25 6.5 11.25 12.5 4.75"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (status === "active") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--mandate-accent)]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
          <path d="M6 3.5 11.5 8 6 12.5V3.5Z" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className="mt-0.5 h-2 w-2 shrink-0 rounded-full border border-white/20 bg-transparent"
      aria-hidden="true"
    />
  );
}

interface PlanningLoadingStateProps {
  phase: StartSessionPhase;
  summary: PlanningSummary;
}

export function PlanningLoadingState({ phase, summary }: PlanningLoadingStateProps) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const [planningPulse, setPlanningPulse] = useState(0);

  useEffect(() => {
    if (phase !== "planning") {
      setPlanningPulse(0);
      return;
    }

    const interval = window.setInterval(() => {
      setPlanningPulse((current) => current + 1);
    }, 2200);

    return () => window.clearInterval(interval);
  }, [phase]);

  const stageStatuses = useMemo(
    () => resolveStageStatuses(phase, planningPulse),
    [phase, planningPulse],
  );

  const stages = useMemo(
    () =>
      PLANNING_STAGES.map((stage, index) => ({
        ...stage,
        detail:
          index === 0
            ? summary.goalText
            : stage.detail,
        status: stageStatuses[index],
      })),
    [stageStatuses, summary.goalText],
  );

  const motionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, ease: "easeOut" as const },
      };

  return (
    <div
      className="rounded-2xl border border-white/10 bg-black/20 p-6 shadow-xl shadow-black/20 sm:p-8"
      role="status"
      aria-live="polite"
      aria-busy={phase !== "completed"}
    >
      <motion.div {...motionProps} className="space-y-6">
        <header className="space-y-4 border-b border-white/8 pb-6">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
              Mandate
            </p>
            <h2 className="text-xl font-medium text-white sm:text-2xl">
              Planning your grocery run
            </h2>
          </div>

          <div className="space-y-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3.5">
            <p className="text-sm leading-relaxed text-slate-200">
              &ldquo;{summary.goalText}&rdquo;
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span className="tabular-nums">₹{summary.budgetDisplay} budget</span>
              <span aria-hidden="true">·</span>
              <span>{summary.mandateLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{summary.mandateCeiling}</span>
            </div>
          </div>

          <PlanningIndicator active={phase !== "completed"} reducedMotion={prefersReducedMotion} />
        </header>

        <ol className="space-y-4" aria-label="Planning progress">
          <AnimatePresence mode="popLayout">
            {stages.map((stage) => (
              <motion.li
                key={stage.id}
                layout={!prefersReducedMotion}
                initial={prefersReducedMotion ? false : { opacity: 0.6 }}
                animate={{ opacity: 1 }}
                className="flex gap-3"
              >
                <StageIcon status={stage.status} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p
                    className={
                      stage.status === "active"
                        ? "text-sm font-medium text-white"
                        : stage.status === "complete"
                          ? "text-sm text-slate-300"
                          : "text-sm text-slate-500"
                    }
                  >
                    {stage.title}
                  </p>
                  {stage.detail ? (
                    <p
                      className={
                        stage.status === "pending"
                          ? "text-xs text-slate-600"
                          : "text-xs text-slate-400"
                      }
                    >
                      {stage.detail}
                    </p>
                  ) : null}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </motion.div>
    </div>
  );
}

function PlanningIndicator({
  active,
  reducedMotion,
}: {
  active: boolean;
  reducedMotion: boolean;
}) {
  if (!active) {
    return (
      <p className="text-sm text-[var(--mandate-accent)]">
        Planning complete — opening your options
      </p>
    );
  }

  if (reducedMotion) {
    return (
      <p className="text-sm text-slate-400">Mandate is working on your basket…</p>
    );
  }

  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/8">
        <motion.div
          className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--mandate-accent)]/70"
          animate={{ x: ["-100%", "320%"] }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>
      <div className="flex gap-1">
        {[0, 1, 2].map((dot) => (
          <motion.span
            key={dot}
            className="h-1.5 w-1.5 rounded-full bg-[var(--mandate-accent)]"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: dot * 0.2,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface PlanningErrorStateProps {
  summary: PlanningSummary;
  message: string;
  onRetry: () => void;
}

export function PlanningErrorState({
  summary,
  message,
  onRetry,
}: PlanningErrorStateProps) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const motionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, ease: "easeOut" as const },
      };

  return (
    <motion.div
      {...motionProps}
      className="rounded-2xl border border-red-400/20 bg-black/20 p-6 shadow-xl shadow-black/20 sm:p-8"
      role="alert"
    >
      <div className="space-y-6">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-red-300/80">
            Mandate
          </p>
          <h2 className="text-xl font-medium text-white sm:text-2xl">
            Mandate couldn&apos;t finish planning
          </h2>
          <p className="text-sm leading-relaxed text-red-200/90">{message}</p>
        </header>

        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3.5">
          <p className="text-sm leading-relaxed text-slate-300">
            &ldquo;{summary.goalText}&rdquo;
          </p>
          <p className="mt-2 text-xs text-slate-500">
            ₹{summary.budgetDisplay} budget · {summary.mandateLabel}
          </p>
        </div>

        <button
          type="button"
          onClick={onRetry}
          className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--mandate-accent)] px-5 py-3.5 text-base font-medium text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mandate-accent)]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mandate-bg)] sm:w-auto"
        >
          Try again
        </button>
      </div>
    </motion.div>
  );
}
