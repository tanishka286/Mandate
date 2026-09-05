const MANDATE_LABELS: Record<string, string> = {
  "77777777-7777-4777-8777-777777777701": "Mandate A",
  "77777777-7777-4777-8777-777777777702": "Mandate B",
};

export function mandateLabelForId(mandateId: string | undefined): string {
  if (!mandateId) {
    return "Spending mandate";
  }
  return MANDATE_LABELS[mandateId] ?? "Spending mandate";
}

export function basketTypeLabel(
  basketType: "BEST_VALUE" | "BEST_QUALITY" | null | undefined,
): string {
  if (basketType === "BEST_VALUE") {
    return "Best Value";
  }
  if (basketType === "BEST_QUALITY") {
    return "Best Quality";
  }
  return "Selected basket";
}
