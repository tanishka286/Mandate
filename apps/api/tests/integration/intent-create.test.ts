import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ErrorCodes } from "../../src/shared/constants/index.js";

const JWT_SECRET = "test-jwt-secret-for-intent-create-phase3";

const userA = "44444444-4444-4444-8444-444444444401";
const userB = "44444444-4444-4444-8444-444444444402";

const sessionAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const sessionEndedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const sessionBId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";

const mandateAId = "77777777-7777-4777-8777-777777777701";
const mandateBUserId = "77777777-7777-4777-8777-777777777703";

type SessionRow = {
  session_id: string;
  user_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

type IntentRow = {
  intent_id: string;
  session_id: string;
  mandate_id: string;
  goal_text: string;
  category: string;
  budget_minor: number | null;
  quality_preference: string | null;
  status: string;
  assumptions_json: unknown[];
  created_at: string;
  updated_at: string;
};

type MandateRow = {
  mandate_id: string;
  user_id: string;
  agent_id: string;
  max_spend_minor: number;
  currency: string;
  max_per_item_minor: number | null;
  purpose: string | null;
  valid_until: string;
  status: string;
  created_at: string;
  updated_at: string;
};

const sessions = new Map<string, SessionRow>();
const intents = new Map<string, IntentRow>();
const mandates = new Map<string, MandateRow>();
const mandateCategories = new Map<string, string[]>();

let intentSeq = 0;

function resetStore(): void {
  sessions.clear();
  intents.clear();
  mandates.clear();
  mandateCategories.clear();
  intentSeq = 0;

  sessions.set(sessionAId, {
    session_id: sessionAId,
    user_id: userA,
    status: "ACTIVE",
    started_at: "2026-09-05T06:00:00.000Z",
    ended_at: null,
    created_at: "2026-09-05T06:00:00.000Z",
  });
  sessions.set(sessionEndedId, {
    session_id: sessionEndedId,
    user_id: userA,
    status: "ENDED",
    started_at: "2026-09-05T06:00:00.000Z",
    ended_at: "2026-09-05T07:00:00.000Z",
    created_at: "2026-09-05T06:00:00.000Z",
  });
  sessions.set(sessionBId, {
    session_id: sessionBId,
    user_id: userB,
    status: "ACTIVE",
    started_at: "2026-09-05T06:00:00.000Z",
    ended_at: null,
    created_at: "2026-09-05T06:00:00.000Z",
  });

  mandates.set(mandateAId, {
    mandate_id: mandateAId,
    user_id: userA,
    agent_id: "agent-001",
    max_spend_minor: 100000,
    currency: "INR",
    max_per_item_minor: 30000,
    purpose: "Mandate A",
    valid_until: "2026-12-31T23:59:59.000Z",
    status: "ACTIVE",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  mandates.set(mandateBUserId, {
    mandate_id: mandateBUserId,
    user_id: userB,
    agent_id: "agent-002",
    max_spend_minor: 100000,
    currency: "INR",
    max_per_item_minor: 30000,
    purpose: "Mandate C user B",
    valid_until: "2026-12-31T23:59:59.000Z",
    status: "ACTIVE",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  mandateCategories.set(mandateAId, ["grocery"]);
  mandateCategories.set(mandateBUserId, ["grocery"]);
}

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "1h" });
}

const validBody = {
  goal_text: "Pasta for 4, budget ₹1000",
  budget_minor: 100000,
  category: "grocery",
  quality_preference: null,
  constraints: [],
  mandate_id: mandateAId,
};

vi.mock("../../src/config/supabase.js", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === "shopping_session") {
        return {
          select: () => ({
            eq: (_col: string, sessionId: string) => ({
              maybeSingle: async () => ({
                data: sessions.get(sessionId) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "shopping_intent") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                intentSeq += 1;
                const intentId =
                  (row.intent_id as string | undefined) ??
                  `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb${String(intentSeq).padStart(3, "0")}`;
                const now = "2026-09-05T06:10:00.000Z";
                const stored: IntentRow = {
                  intent_id: intentId,
                  session_id: String(row.session_id),
                  mandate_id: String(row.mandate_id),
                  goal_text: String(row.goal_text),
                  category: String(row.category),
                  budget_minor:
                    row.budget_minor === undefined || row.budget_minor === null
                      ? null
                      : Number(row.budget_minor),
                  quality_preference:
                    row.quality_preference === undefined
                      ? null
                      : (row.quality_preference as string | null),
                  status: String(row.status ?? "CREATED"),
                  assumptions_json: Array.isArray(row.assumptions_json)
                    ? (row.assumptions_json as unknown[])
                    : [],
                  created_at: now,
                  updated_at: now,
                };
                intents.set(intentId, stored);
                return { data: stored, error: null };
              },
            }),
          }),
          select: () => ({
            eq: (_col: string, intentId: string) => ({
              maybeSingle: async () => ({
                data: intents.get(intentId) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "mandate") {
        const filter: { mandate_id?: string; user_id?: string } = {};
        const api = {
          select: () => api,
          eq: (col: string, value: string) => {
            if (col === "mandate_id") filter.mandate_id = value;
            if (col === "user_id") filter.user_id = value;
            return api;
          },
          maybeSingle: async () => {
            if (!filter.mandate_id) {
              return { data: null, error: null };
            }
            const row = mandates.get(filter.mandate_id) ?? null;
            if (!row) {
              return { data: null, error: null };
            }
            if (filter.user_id && row.user_id !== filter.user_id) {
              return { data: null, error: null };
            }
            return { data: row, error: null };
          },
        };
        return api;
      }

      if (table === "mandate_category") {
        return {
          select: () => ({
            eq: (_col: string, mandateId: string) => ({
              order: async () => {
                const cats = mandateCategories.get(mandateId) ?? [];
                return {
                  data: cats.map((category) => ({
                    mandate_id: mandateId,
                    category,
                  })),
                  error: null,
                };
              },
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

async function loadApp() {
  const { loadEnv } = await import("../../src/config/env.js");
  loadEnv({
    NODE_ENV: "test",
    JWT_SECRET,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  });
  const { createApp } = await import("../../src/app.js");
  return createApp();
}

describe("POST /api/v1/sessions/:session_id/intents", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.JWT_SECRET = JWT_SECRET;
    resetStore();
    vi.resetModules();
  });

  it("creates a shopping intent with the Doc 08 response envelope", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionAId}/intents`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("X-Request-ID", "corr-intent-001")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      intent_id: expect.any(String),
      session_id: sessionAId,
      mandate_id: mandateAId,
      status: "CREATED",
    });
    expect(res.body.meta.request_id).toBe("corr-intent-001");
    expect(intents.size).toBe(1);
    const stored = [...intents.values()][0];
    expect(stored.goal_text).toBe(validBody.goal_text);
    expect(stored.budget_minor).toBe(100000);
    expect(stored.assumptions_json).toEqual([]);
  });

  it("rejects invalid payload with VALIDATION_ERROR", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionAId}/intents`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({ ...validBody, goal_text: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(res.body.error.request_id).toBeTruthy();
  });

  it("rejects ENDED session with CONFLICT", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionEndedId}/intents`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it("rejects another user's session with FORBIDDEN", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionBId}/intents`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("rejects cross-user mandate with MANDATE_UNAUTHORIZED", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionAId}/intents`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({ ...validBody, mandate_id: mandateBUserId });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCodes.MANDATE_UNAUTHORIZED);
  });

  it("rejects unauthenticated requests", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionAId}/intents`)
      .send(validBody);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("allows repeated creation without inventing financial idempotency", async () => {
    const app = await loadApp();
    const first = await request(app)
      .post(`/api/v1/sessions/${sessionAId}/intents`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send(validBody);
    const second = await request(app)
      .post(`/api/v1/sessions/${sessionAId}/intents`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send(validBody);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.intent_id).not.toBe(second.body.data.intent_id);
    expect(intents.size).toBe(2);
  });
});
