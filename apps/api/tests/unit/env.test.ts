import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv, isSupabaseConfigured } from "../../src/config/env.js";
import { resetSupabaseClient } from "../../src/config/supabase.js";

describe("env + supabase config", () => {
  afterEach(() => {
    resetSupabaseClient();
  });

  beforeEach(() => {
    resetSupabaseClient();
  });

  it("loads defaults for local development", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      JWT_SECRET: "",
    });
    expect(env.PORT).toBe(4000);
    expect(env.OLLAMA_MODEL).toBe("qwen3:14b");
    expect(env.OLLAMA_BASE_URL).toBe("http://localhost:11434");
    expect(env.AGENT_MAX_RECOVERY_ATTEMPTS).toBe(2);
    expect(env.AGENT_LLM_MAX_RETRIES).toBe(1);
    expect(isSupabaseConfigured(env)).toBe(false);
  });

  it("detects configured supabase credentials", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    });
    expect(isSupabaseConfigured(env)).toBe(true);
  });
});
