/** Format a rupee amount string for display (e.g. "1000" → "1,000"). */
export function formatBudgetRupeesDisplay(value: string): string {
  const trimmed = value.trim().replace(/,/g, "");
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return value.trim();
  }
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(parsed);
}
