import { APP_NAME } from "@mandate/config";

/**
 * Phase 0 foundation page only - no grocery shopping UI yet.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm uppercase tracking-[0.2em] text-[var(--mandate-accent)]">
        Phase 0
      </p>
      <h1 className="text-5xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-lg text-slate-300">
        AI-native grocery commerce foundation. The frontend talks only to the
        Express API - never directly to Supabase.
      </p>
      <p className="text-sm text-slate-400">
        AI reasons -&gt; User chooses -&gt; Backend validates -&gt; Policy authorizes -&gt;
        Razorpay executes -&gt; Audit records
      </p>
    </main>
  );
}
