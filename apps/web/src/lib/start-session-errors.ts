/**
 * Maps API and validation failures to human-readable copy.
 * Never surfaces stack traces, JWTs, or raw server payloads.
 */

export function validateGoal(goalText: string): string | null {
  if (!goalText.trim()) {
    return "Tell Mandate what you need — your goal can't be empty.";
  }
  return null;
}

export function validateBudgetRupees(value: string): {
  budgetMinor: number;
  error: string | null;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { budgetMinor: 0, error: "Enter a budget so Mandate can plan within your limit." };
  }

  const parsed = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      budgetMinor: 0,
      error: "Enter a valid budget in rupees (for example, 1000).",
    };
  }

  const budgetMinor = Math.round(parsed * 100);
  if (!Number.isInteger(budgetMinor) || budgetMinor <= 0) {
    return {
      budgetMinor: 0,
      error: "Enter a valid budget in rupees (for example, 1000).",
    };
  }

  return { budgetMinor, error: null };
}

export function toUserFacingStartError(err: unknown): string {
  if (!(err instanceof Error)) {
    return "Mandate couldn't start your shopping plan. Please try again.";
  }

  const message = err.message.toLowerCase();

  if (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed")
  ) {
    return "Mandate couldn't reach the server. Please check your connection and try again.";
  }

  if (
    message.includes("401") ||
    message.includes("unauthorized") ||
    message.includes("jwt") ||
    message.includes("token expired") ||
    message.includes("invalid token")
  ) {
    return "Your demo session has expired. Please try again.";
  }

  if (
    message.includes("403") ||
    message.includes("forbidden")
  ) {
    return "Mandate couldn't authorize this request. Please try again.";
  }

  if (
    message.includes("503") ||
    message.includes("not configured") ||
    message.includes("service unavailable")
  ) {
    return "Mandate is temporarily unavailable. Please try again shortly.";
  }

  if (message.includes("planning did not complete")) {
    return "Planning didn't complete successfully. Try a different goal or budget.";
  }

  if (message.includes("request failed: 5")) {
    return "Mandate couldn't start your shopping plan. Please try again.";
  }

  if (message.includes("request failed: 4")) {
    return "Mandate couldn't process your request. Check your goal and budget, then try again.";
  }

  return "Mandate couldn't start your shopping plan. Please try again.";
}
