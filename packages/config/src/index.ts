/**
 * Shared non-secret configuration constants.
 * Secrets belong in environment variables only.
 */

export const APP_NAME = "Mandate";

export const API_PREFIX = "/api/v1";

export const DEFAULT_API_PORT = 4000;

export const DEFAULT_FRONTEND_URL = "http://localhost:3000";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export const DEFAULT_OLLAMA_MODEL = "qwen3:14b";

/** Default bounded recovery attempts after recoverable policy DENY. */
export const DEFAULT_AGENT_MAX_RECOVERY_ATTEMPTS = 2;

/** Default bounded LLM structured-output validation retries. */
export const DEFAULT_AGENT_LLM_MAX_RETRIES = 1;

/** Default Ollama HTTP request timeout (ms) — requirement extraction on local Qwen3:14B. */
export const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS = 120_000;

/** Default Ollama model keep-alive during demo sessions (not unload between requests). */
export const DEFAULT_OLLAMA_KEEP_ALIVE = "30m";

/** Max tokens for structured requirement extraction (small JSON only). */
export const DEFAULT_OLLAMA_STRUCTURED_NUM_PREDICT = 768;

/**
 * Planning requirement extraction mode.
 * - llm: Qwen proposes structured requirements (buildathon default in development).
 * - deterministic: regex/canonical demo path (tests / explicit fallback).
 */
export const PLANNING_REQUIREMENT_MODES = ["llm", "deterministic"] as const;

export type PlanningRequirementMode =
  (typeof PLANNING_REQUIREMENT_MODES)[number];

export const DEFAULT_PLANNING_REQUIREMENT_MODE: PlanningRequirementMode = "llm";

/** INR minor unit: 1 rupee = 100 paise */
export const INR_MINOR_UNIT = 100;
