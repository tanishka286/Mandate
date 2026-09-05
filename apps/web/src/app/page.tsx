import { DemoStartForm } from "@/components/DemoStartForm";
import { DemoJourneyIndicator } from "@/components/DemoJourneyIndicator";

const FLOW_STEPS = [
  { label: "You describe", detail: "Goal + budget in plain language" },
  { label: "Mandate plans", detail: "AI understands & researches" },
  { label: "You choose", detail: "Best Value or Best Quality" },
  { label: "Policy authorizes", detail: "Fresh quote + mandate check" },
  { label: "You pay", detail: "Razorpay after ALLOW only" },
] as const;

/**
 * Buildathon landing — authoritative session start (Frontend Step 1).
 */
export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_top,rgba(61,139,110,0.14),transparent_65%)]"
        aria-hidden="true"
      />

      <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-10 sm:px-8 sm:py-14 lg:py-16">
        <header className="mb-10 sm:mb-14">
          <div className="mb-6">
            <DemoJourneyIndicator currentStep="goal" />
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--mandate-accent)]">
            Mandate
          </p>
        </header>

        <div className="grid flex-1 gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start lg:gap-14">
          <section className="space-y-8">
            <div className="space-y-5">
              <h1 className="max-w-xl text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[3.25rem]">
                Your AI grocery buyer
              </h1>
              <p className="max-w-lg text-lg leading-relaxed text-slate-300 sm:text-xl">
                Tell Mandate what you need. We&apos;ll build the best basket within
                your budget.
              </p>
              <p className="max-w-lg text-sm leading-relaxed text-slate-400">
                AI recommends. You choose. The backend validates every price,
                policy decision, and payment — never the browser.
              </p>
            </div>

            <ol className="grid gap-3 sm:grid-cols-2">
              {FLOW_STEPS.map((step, index) => (
                <li
                  key={step.label}
                  className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {index + 1}. {step.label}
                  </p>
                  <p className="mt-1 text-sm text-slate-300">{step.detail}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="start-heading" className="lg:pt-2">
            <div className="mb-5 space-y-1">
              <h2
                id="start-heading"
                className="text-lg font-medium text-white sm:text-xl"
              >
                Tell Mandate what you need
              </h2>
              <p className="text-sm text-slate-400">
                Start a real shopping session — planning runs on the backend.
              </p>
            </div>
            <DemoStartForm />
          </section>
        </div>

        <footer className="mt-14 border-t border-white/8 pt-6 text-xs text-slate-500">
          Mandate API is the source of truth for baskets, policy, and payments.
        </footer>
      </main>
    </div>
  );
}
