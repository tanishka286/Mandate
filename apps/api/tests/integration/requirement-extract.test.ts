import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ErrorCodes } from "../../src/shared/constants/index.js";

const JWT_SECRET = "test-jwt-secret-for-requirement-extract-phase3";

const userA = "44444444-4444-4444-8444-444444444401";
const userB = "44444444-4444-4444-8444-444444444402";

const sessionAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const sessionBId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const intentEggsId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const intentAmbiguousId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const intentPastaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03";
const intentBrandId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04";
const intentClosedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05";
const intentOtherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06";

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

type RequirementRow = {
  requirement_id: string;
  intent_id: string;
  item_name: string;
  target_quantity: number;
  unit: string;
  minimum_quality: string | null;
  constraints_json: unknown[];
  confidence: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const sessions = new Map<string, SessionRow>();
const intents = new Map<string, IntentRow>();
const requirements = new Map<string, RequirementRow>();

let reqSeq = 0;

function resetStore(): void {
  sessions.clear();
  intents.clear();
  requirements.clear();
  reqSeq = 0;

  sessions.set(sessionAId, {
    session_id: sessionAId,
    user_id: userA,
    status: "ACTIVE",
    started_at: "2026-09-05T06:00:00.000Z",
    ended_at: null,
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

  const now = "2026-09-05T06:10:00.000Z";
  intents.set(intentEggsId, {
    intent_id: intentEggsId,
    session_id: sessionAId,
    mandate_id: "77777777-7777-4777-8777-777777777701",
    goal_text: "6 eggs",
    category: "grocery",
    budget_minor: null,
    quality_preference: null,
    status: "CREATED",
    assumptions_json: [],
    created_at: now,
    updated_at: now,
  });
  intents.set(intentAmbiguousId, {
    intent_id: intentAmbiguousId,
    session_id: sessionAId,
    mandate_id: "77777777-7777-4777-8777-777777777701",
    goal_text: "something for dinner",
    category: "grocery",
    budget_minor: null,
    quality_preference: null,
    status: "CREATED",
    assumptions_json: [],
    created_at: now,
    updated_at: now,
  });
  intents.set(intentPastaId, {
    intent_id: intentPastaId,
    session_id: sessionAId,
    mandate_id: "77777777-7777-4777-8777-777777777701",
    goal_text: "Pasta for 4, budget ₹1000",
    category: "grocery",
    budget_minor: 100000,
    quality_preference: null,
    status: "CREATED",
    assumptions_json: [],
    created_at: now,
    updated_at: now,
  });
  intents.set(intentBrandId, {
    intent_id: intentBrandId,
    session_id: sessionAId,
    mandate_id: "77777777-7777-4777-8777-777777777701",
    goal_text: "6 eggs, brand Farm Fresh",
    category: "grocery",
    budget_minor: null,
    quality_preference: null,
    status: "CREATED",
    assumptions_json: [],
    created_at: now,
    updated_at: now,
  });
  intents.set(intentClosedId, {
    intent_id: intentClosedId,
    session_id: sessionAId,
    mandate_id: "77777777-7777-4777-8777-777777777701",
    goal_text: "6 eggs",
    category: "grocery",
    budget_minor: null,
    quality_preference: null,
    status: "CLOSED",
    assumptions_json: [],
    created_at: now,
    updated_at: now,
  });
  intents.set(intentOtherUserId, {
    intent_id: intentOtherUserId,
    session_id: sessionBId,
    mandate_id: "77777777-7777-4777-8777-777777777702",
    goal_text: "6 eggs",
    category: "grocery",
    budget_minor: null,
    quality_preference: null,
    status: "CREATED",
    assumptions_json: [],
    created_at: now,
    updated_at: now,
  });
}

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "1h" });
}

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
          select: () => ({
            eq: (_col: string, intentId: string) => ({
              maybeSingle: async () => ({
                data: intents.get(intentId) ?? null,
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, intentId: string) => ({
              select: () => ({
                single: async () => {
                  const existing = intents.get(intentId);
                  if (!existing) {
                    return {
                      data: null,
                      error: { message: "not found", code: "PGRST116" },
                    };
                  }
                  const updated: IntentRow = {
                    ...existing,
                    status: String(patch.status ?? existing.status),
                    assumptions_json: Array.isArray(patch.assumptions_json)
                      ? (patch.assumptions_json as unknown[])
                      : existing.assumptions_json,
                    updated_at: String(
                      patch.updated_at ?? existing.updated_at,
                    ),
                  };
                  intents.set(intentId, updated);
                  return { data: updated, error: null };
                },
              }),
            }),
          }),
        };
      }

      if (table === "requirement") {
        return {
          select: () => ({
            eq: (_col: string, intentId: string) => ({
              order: async () => ({
                data: [...requirements.values()].filter(
                  (r) => r.intent_id === intentId,
                ),
                error: null,
              }),
            }),
          }),
          insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => ({
            select: async () => {
              const list = Array.isArray(rows) ? rows : [rows];
              const now = "2026-09-05T06:20:00.000Z";
              const stored = list.map((row) => {
                reqSeq += 1;
                const requirementId =
                  (row.requirement_id as string | undefined) ??
                  `cccccccc-cccc-4ccc-8ccc-ccccccccc${String(reqSeq).padStart(3, "0")}`;
                const item: RequirementRow = {
                  requirement_id: requirementId,
                  intent_id: String(row.intent_id),
                  item_name: String(row.item_name),
                  target_quantity: Number(row.target_quantity),
                  unit: String(row.unit),
                  minimum_quality:
                    row.minimum_quality === undefined
                      ? null
                      : (row.minimum_quality as string | null),
                  constraints_json: Array.isArray(row.constraints_json)
                    ? (row.constraints_json as unknown[])
                    : [],
                  confidence:
                    row.confidence === undefined || row.confidence === null
                      ? null
                      : Number(row.confidence),
                  status: String(row.status ?? "CREATED"),
                  created_at: now,
                  updated_at: now,
                };
                requirements.set(requirementId, item);
                return item;
              });
              return { data: stored, error: null };
            },
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

describe("POST /api/v1/intents/:intent_id/requirements:extract", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.JWT_SECRET = JWT_SECRET;
    resetStore();
    vi.resetModules();
  });

  it("extracts 6 eggs into a structured requirement envelope", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/intents/${intentEggsId}/requirements:extract`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .set("X-Request-ID", "corr-extract-001");

    expect(res.status).toBe(200);
    expect(res.body.meta.request_id).toBe("corr-extract-001");
    expect(res.body.data.status).toBe("SUCCESS");
    expect(res.body.data.intent_id).toBe(intentEggsId);
    expect(res.body.data.requirements).toEqual([
      expect.objectContaining({
        item_name: "eggs",
        target_quantity: 6,
        unit: "pieces",
        confidence: 1,
      }),
    ]);
    expect(requirements.size).toBe(1);
    expect(intents.get(intentEggsId)?.status).toBe("PLANNING");
  });

  it("extracts pasta for 4 with quantity basis and keeps budget on intent", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/intents/${intentPastaId}/requirements:extract`)
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("SUCCESS");
    expect(res.body.data.requirements[0]).toMatchObject({
      item_name: "pasta",
      target_quantity: 2,
      unit: "packs",
    });
    expect(
      res.body.data.requirements.every(
        (r: { item_name: string }) => r.item_name !== "budget",
      ),
    ).toBe(true);
    expect(intents.get(intentPastaId)?.budget_minor).toBe(100000);
  });

  it("preserves brand constraints", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/intents/${intentBrandId}/requirements:extract`)
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("SUCCESS");
    const stored = [...requirements.values()][0];
    expect(stored.constraints_json).toEqual([
      { type: "brand", value: "Farm Fresh" },
    ]);
  });

  it("returns clarification for material ambiguity without persisting", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/intents/${intentAmbiguousId}/requirements:extract`)
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CLARIFICATION_REQUIRED");
    expect(res.body.data.clarification.question).toBeTruthy();
    expect(requirements.size).toBe(0);
  });

  it("does not duplicate requirements on repeated extraction", async () => {
    const app = await loadApp();
    const first = await request(app)
      .post(`/api/v1/intents/${intentEggsId}/requirements:extract`)
      .set("Authorization", `Bearer ${signToken(userA)}`);
    const second = await request(app)
      .post(`/api/v1/intents/${intentEggsId}/requirements:extract`)
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.requirements[0].requirement_id).toBe(
      second.body.data.requirements[0].requirement_id,
    );
    expect(requirements.size).toBe(1);
  });

  it("rejects cross-user intent", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/intents/${intentOtherUserId}/requirements:extract`)
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("rejects missing intent", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(
        "/api/v1/intents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb99/requirements:extract",
      )
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it("rejects malformed intent UUID", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post("/api/v1/intents/not-a-uuid/requirements:extract")
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("rejects invalid intent state", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/intents/${intentClosedId}/requirements:extract`)
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it("returns clarification for eggs without quantity (no fabricated quantity)", async () => {
    intents.set("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb07", {
      intent_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb07",
      session_id: sessionAId,
      mandate_id: "77777777-7777-4777-8777-777777777701",
      goal_text: "eggs",
      category: "grocery",
      budget_minor: null,
      quality_preference: null,
      status: "CREATED",
      assumptions_json: [],
      created_at: "2026-09-05T06:10:00.000Z",
      updated_at: "2026-09-05T06:10:00.000Z",
    });
    const app = await loadApp();
    const res = await request(app)
      .post(
        "/api/v1/intents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb07/requirements:extract",
      )
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CLARIFICATION_REQUIRED");
    expect(requirements.size).toBe(0);
  });

  it("extracts multiple explicit requirements atomically", async () => {
    intents.set("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb08", {
      intent_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb08",
      session_id: sessionAId,
      mandate_id: "77777777-7777-4777-8777-777777777701",
      goal_text: "6 eggs and 2 packs pasta",
      category: "grocery",
      budget_minor: null,
      quality_preference: null,
      status: "CREATED",
      assumptions_json: [],
      created_at: "2026-09-05T06:10:00.000Z",
      updated_at: "2026-09-05T06:10:00.000Z",
    });
    const app = await loadApp();
    const res = await request(app)
      .post(
        "/api/v1/intents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb08/requirements:extract",
      )
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("SUCCESS");
    expect(res.body.data.requirements).toHaveLength(2);
    expect(requirements.size).toBe(2);
  });
});
