/**
 * Frontend runtime config.
 * The web app must call the Mandate API - never Supabase service credentials.
 */
export const apiConfig = {
  baseUrl:
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1",
} as const;
