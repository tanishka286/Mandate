import { BasketSelectionExperience } from "@/components/BasketSelectionExperience";

/**
 * Phase 7 selection + Phase 8 checkout.
 * Live mode: /select?sessionId=...&token=...&mandateId=...
 */
export default async function SelectPage({
  searchParams,
}: {
  searchParams: Promise<{
    sessionId?: string;
    token?: string;
    mandateId?: string;
    goalText?: string;
  }>;
}) {
  const params = await searchParams;

  return (
    <main className="min-h-screen">
      <BasketSelectionExperience
        sessionId={params.sessionId}
        token={params.token}
        mandateId={params.mandateId}
        goalText={params.goalText}
      />
    </main>
  );
}
