const BOUNDARIES = [
  {
    title: "AI planning",
    description: "AI proposes what may satisfy your request.",
  },
  {
    title: "Commerce system",
    description: "Catalog, stock, and prices are authoritative.",
  },
  {
    title: "Policy",
    description: "Your mandate independently authorizes the final basket.",
  },
  {
    title: "Payment",
    description: "Razorpay executes only after authorization.",
  },
  {
    title: "Verification",
    description: "Mandate verifies the payment server-side.",
  },
] as const;

export function TrustBoundaryPanel() {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-6">
      <h3 className="text-sm font-medium text-white">Why this is safe</h3>
      <p className="mt-1 text-xs text-slate-500">
        Each layer has a single authority — nothing is trusted from the browser alone.
      </p>
      <ol className="mt-4 space-y-3">
        {BOUNDARIES.map((item, index) => (
          <li key={item.title} className="flex gap-3">
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-xs text-slate-400"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-slate-200">{item.title}</p>
              <p className="text-xs text-slate-500">{item.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
