import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import {
  DEFAULT_API_PORT,
  DEFAULT_FRONTEND_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_AGENT_MAX_RECOVERY_ATTEMPTS,
  DEFAULT_AGENT_LLM_MAX_RETRIES,
  DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS,
  DEFAULT_OLLAMA_KEEP_ALIVE,
  DEFAULT_OLLAMA_STRUCTURED_NUM_PREDICT,
  DEFAULT_PLANNING_REQUIREMENT_MODE,
  PLANNING_REQUIREMENT_MODES,
} from "@mandate/config";

/**
 * Server-side environment configuration.
 * Never log or expose secret values from this object.
 *
 * Loads the nearest .env without overriding already-set process env vars.
 * Real secrets must never be committed - only .env.example is tracked.
 */
function loadDotenvFiles(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../../../.env"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false, quiet: true });
    }
  }
}

loadDotenvFiles();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(DEFAULT_API_PORT),
  FRONTEND_URL: z.string().url().default(DEFAULT_FRONTEND_URL),

  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),

  OLLAMA_BASE_URL: z.string().url().default(DEFAULT_OLLAMA_BASE_URL),
  OLLAMA_MODEL: z.string().default(DEFAULT_OLLAMA_MODEL),

  /** Bounded HTTP timeout for Ollama generate calls (prevents indefinite hangs). */
  OLLAMA_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(600_000)
    .default(DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS),

  /**
   * Ollama keep_alive passed on generate requests (e.g. "30m", "-1").
   * Keeps the model loaded during demo sessions — never use keep_alive: 0 in product flows.
   */
  OLLAMA_KEEP_ALIVE: z.string().min(1).default(DEFAULT_OLLAMA_KEEP_ALIVE),

  /** Max output tokens for structured LLM JSON (requirement extraction). */
  OLLAMA_STRUCTURED_NUM_PREDICT: z.coerce
    .number()
    .int()
    .positive()
    .max(4096)
    .default(DEFAULT_OLLAMA_STRUCTURED_NUM_PREDICT),

  /**
   * Requirement extraction mode for session planning.
   * Defaults to deterministic in test, llm otherwise (see resolvePlanningRequirementMode).
   */
  PLANNING_REQUIREMENT_MODE: z
    .enum(PLANNING_REQUIREMENT_MODES)
    .optional(),

  /**
   * When true, planning skips synchronous Qwen recommendation prose.
   * Deterministic backend recommendation remains authoritative.
   */
  AGENT_SKIP_LLM_RECOMMENDATION: z
    .preprocess((value) => {
      if (value === undefined || value === null || value === "") {
        return true;
      }
      if (typeof value === "boolean") {
        return value;
      }
      return String(value).toLowerCase() !== "false";
    }, z.boolean())
    .default(true),

  /**
   * Bounded policy-denial recovery attempts for the internal agent orchestrator.
   * Agent may re-optimize within mandate constraints; never expands the mandate.
   */
  AGENT_MAX_RECOVERY_ATTEMPTS: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(5)
    .default(DEFAULT_AGENT_MAX_RECOVERY_ATTEMPTS),

  /** Bounded retries when LLM structured output fails Zod validation. */
  AGENT_LLM_MAX_RETRIES: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(3)
    .default(DEFAULT_AGENT_LLM_MAX_RETRIES),

  RAZORPAY_KEY_ID: z.string().optional().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),
  RAZORPAY_ENV: z.enum(["test"]).default("test"),

  JWT_SECRET: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(overrides?: Record<string, string | undefined>): Env {
  const source = { ...process.env, ...overrides };
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  cached = parsed.data;
  return cached;
}

export function getEnv(): Env {
  if (!cached) {
    return loadEnv();
  }
  return cached;
}

/** True when Supabase credentials are present (required for DB-backed operations). */
export function isSupabaseConfigured(env: Env = getEnv()): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

/** True when Razorpay Test Mode credentials are configured. */
export function isRazorpayTestConfigured(env: Env = getEnv()): boolean {
  return Boolean(
    env.RAZORPAY_KEY_ID &&
      env.RAZORPAY_KEY_SECRET &&
      env.RAZORPAY_ENV === "test",
  );
}

/** Resolved planning requirement mode (test defaults to deterministic). */
export function resolvePlanningRequirementMode(
  env: Env = getEnv(),
): "llm" | "deterministic" {
  if (env.PLANNING_REQUIREMENT_MODE) {
    return env.PLANNING_REQUIREMENT_MODE;
  }
  return env.NODE_ENV === "test" ? "deterministic" : DEFAULT_PLANNING_REQUIREMENT_MODE;
}
