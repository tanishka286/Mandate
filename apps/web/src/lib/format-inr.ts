/** Format authoritative minor-unit INR amounts for display. */
export function formatInr(minor: number, options?: { compact?: boolean }): string {
  const rupees = minor / 100;
  if (options?.compact) {
    return `₹${new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    }).format(rupees)}`;
  }
  return `₹${rupees.toFixed(2)}`;
}
