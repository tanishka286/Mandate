import Link from "next/link";
import { APP_NAME } from "@mandate/config";

/**
 * Foundation landing — links into Phase 7 basket selection.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm uppercase tracking-[0.2em] text-[var(--mandate-accent)]">
        Mandate
      </p>
      <h1 className="text-5xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-lg text-slate-300">
        AI-native grocery commerce. The frontend talks only to the Express API —
        never directly to Supabase.
      </p>
      <p className="text-sm text-slate-400">
        AI reasons → User chooses → Backend validates → Policy authorizes →
        Razorpay executes → Audit records
      </p>
      <Link
        href="/select"
        className="mt-4 inline-flex w-fit items-center rounded-md bg-[var(--mandate-accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
      >
        Choose Best Value or Best Quality
      </Link>
    </main>
  );
}
