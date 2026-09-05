const JOURNEY_STEPS = [
  { id: "goal", label: "Goal" },
  { id: "understand", label: "Understand" },
  { id: "compare", label: "Compare" },
  { id: "authorize", label: "Authorize" },
  { id: "pay", label: "Pay" },
  { id: "confirm", label: "Confirm" },
] as const;

export type DemoJourneyStep = (typeof JOURNEY_STEPS)[number]["id"];

export function DemoJourneyIndicator(props: { currentStep: DemoJourneyStep }) {
  const currentIndex = JOURNEY_STEPS.findIndex(
    (step) => step.id === props.currentStep,
  );

  return (
    <nav
      aria-label="Demo journey"
      className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 sm:px-4"
    >
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 sm:gap-x-2">
        {JOURNEY_STEPS.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isComplete = index < currentIndex;

          return (
            <li key={step.id} className="flex items-center gap-1 sm:gap-2">
              <span
                className={[
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition",
                  isCurrent
                    ? "bg-[var(--mandate-accent)]/15 text-[var(--mandate-accent)] ring-1 ring-[var(--mandate-accent)]/30"
                    : isComplete
                      ? "text-slate-400"
                      : "text-slate-600",
                ].join(" ")}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span
                  className={[
                    "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                    isCurrent
                      ? "bg-[var(--mandate-accent)] text-white"
                      : isComplete
                        ? "bg-[var(--mandate-accent)]/25 text-[var(--mandate-accent)]"
                        : "border border-white/15 text-slate-500",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  {isComplete ? "✓" : index + 1}
                </span>
                <span className="hidden sm:inline">{step.label}</span>
              </span>
              {index < JOURNEY_STEPS.length - 1 ? (
                <span
                  className="hidden text-slate-600 sm:inline"
                  aria-hidden="true"
                >
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
