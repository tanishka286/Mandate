import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

const orderedCategories = [
  {
    category_id: "11111111-1111-4111-8111-111111111104",
    code: "beverages",
    name: "Beverages",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  },
  {
    category_id: "11111111-1111-4111-8111-111111111101",
    code: "dairy",
    name: "Dairy",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  },
  {
    category_id: "11111111-1111-4111-8111-111111111105",
    code: "household",
    name: "Household",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  },
  {
    category_id: "11111111-1111-4111-8111-111111111102",
    code: "pantry",
    name: "Pantry",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  },
  {
    category_id: "11111111-1111-4111-8111-111111111103",
    code: "produce",
    name: "Produce",
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
  },
];

vi.mock("../../src/config/supabase.js", () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        order: async () => ({ data: orderedCategories, error: null }),
      }),
    }),
  }),
  resetSupabaseClient: () => undefined,
  isSupabaseConfigured: () => true,
}));

describe("GET /api/v1/catalog/categories", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns categories in the standard success envelope", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get("/api/v1/catalog/categories");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: {
        categories: expect.any(Array),
      },
      meta: {
        request_id: expect.any(String),
      },
    });
    expect(res.body.data.categories).toHaveLength(5);
    expect(res.body.data.categories.map((c: { code: string }) => c.code)).toEqual([
      "beverages",
      "dairy",
      "household",
      "pantry",
      "produce",
    ]);
    expect(res.headers["x-request-id"]).toBe(res.body.meta.request_id);
  });

  it("returns deterministic category ordering across requests", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const first = await request(app).get("/api/v1/catalog/categories");
    const second = await request(app).get("/api/v1/catalog/categories");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.categories).toEqual(second.body.data.categories);
  });
});
