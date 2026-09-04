import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv } from "../../src/config/env.js";
import { getSupabaseClient, resetSupabaseClient } from "../../src/config/supabase.js";

describe("supabase client foundation", () => {
  beforeEach(() => {
    resetSupabaseClient();
  });

  afterEach(() => {
    resetSupabaseClient();
  });

  it("refuses to init without credentials", () => {
    loadEnv({
      NODE_ENV: "test",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    });
    expect(() => getSupabaseClient()).toThrow(/Supabase is not configured/);
  });

  it("initializes when credentials are present", () => {
    loadEnv({
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    });
    const client = getSupabaseClient();
    expect(client).toBeTruthy();
  });
});
