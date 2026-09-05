const EGG_GOAL_PATTERN = /\beggs?\b/i;

/** Canonical extractable goal for deterministic demo mode only. */
export const DEMO_CANONICAL_EGG_GOAL = "6 eggs";

const EXPLICIT_EGG_QUANTITY_PATTERN =
  /\b(\d+(?:\.\d+)?)\s+(?:[a-z][a-z]*(?:\s+[a-z][a-z]*)*\s+)?eggs?\b/i;

/** Natural-language demo goals that map to the hosted six-egg planning scenario. */
const SUPPORTED_DEMO_GOAL_PATTERNS = [
  /\bingredients\s+for\s+dinner\b/i,
  /\bdinner\s+for\s+\d+\b/i,
  /\bbreakfast\s+for\s+\d+\b/i,
  /\bweekly\s+groceries\b/i,
  EGG_GOAL_PATTERN,
] as const;

/**
 * Deterministic canonical goal resolver — DETERMINISTIC MODE ONLY.
 * Must not be used in LLM planning mode (would silently replace user intent).
 */
export function resolveCanonicalPlanningGoal(goalText: string): string | null {
  const goal = goalText.trim();
  if (!goal) {
    return null;
  }

  if (EXPLICIT_EGG_QUANTITY_PATTERN.test(goal)) {
    return goal;
  }

  if (/\bpasta\s+for\s+\d+\b/i.test(goal)) {
    return goal;
  }

  if (/\b(\d+(?:\.\d+)?)\s*packs?\s+(?:of\s+)?pasta\b/i.test(goal)) {
    return goal;
  }

  if (SUPPORTED_DEMO_GOAL_PATTERNS.some((pattern) => pattern.test(goal))) {
    return DEMO_CANONICAL_EGG_GOAL;
  }

  return null;
}

export function isEggGoalText(goalText: string): boolean {
  return EGG_GOAL_PATTERN.test(goalText);
}
