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

/** INR minor unit: 1 rupee = 100 paise */
export const INR_MINOR_UNIT = 100;
