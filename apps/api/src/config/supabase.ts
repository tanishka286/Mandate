import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv, isSupabaseConfigured } from "./env.js";

/**
 * Centralized server-side Supabase client.
 *
 * Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (SERVER ONLY).
 * Domain repositories must import from this module - do not create ad-hoc clients.
 *
 * Never expose the service role key to:
 * - Next.js frontend / browser
 * - Ollama / AI prompts
 * - client-side JavaScript
 * - logs / git
 */

export type MandateSupabaseClient = SupabaseClient;

let client: MandateSupabaseClient | null = null;

export function getSupabaseClient(): MandateSupabaseClient {
  if (client) {
    return client;
  }

  const env = getEnv();

  if (!isSupabaseConfigured(env)) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return client;
}

/** Test/reset helper - do not use in request handlers. */
export function resetSupabaseClient(): void {
  client = null;
}

/**
 * Thin data-access helper. Keeps Supabase SDK details out of domain services.
 * Repositories should call this (or getSupabaseClient) rather than importing the SDK.
 */
export async function supabaseQuery<T>(
  execute: (db: MandateSupabaseClient) => PromiseLike<{ data: T | null; error: Error | null }>,
): Promise<T> {
  const db = getSupabaseClient();
  const { data, error } = await execute(db);

  if (error) {
    throw error;
  }

  if (data === null) {
    throw new Error("Supabase query returned no data");
  }

  return data;
}
