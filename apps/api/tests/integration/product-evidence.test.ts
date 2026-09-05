import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import {
  SEED_PRODUCT_IDS,
  SEEDED_QUALITY_EVIDENCE,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";

const knownProducts = new Set(Object.values(SEED_PRODUCT_IDS));

vi.mock("../../src/config/supabase.js", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === "product") {
        return {
          select: () => ({
            eq: (_column: string, productId: string) => ({
              maybeSingle: async () => ({
                data: knownProducts.has(
                  productId as (typeof SEED_PRODUCT_IDS)[keyof typeof SEED_PRODUCT_IDS],
                )
                  ? { product_id: productId }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "quality_evidence") {
        return {
          select: () => ({
            eq: (_column: string, productId: string) => ({
              order: () => ({
                order: async () => {
                  const rows = SEEDED_QUALITY_EVIDENCE.filter(
                    (row) => row.product_id === productId,
                  )
                    .map((row) => ({ ...row }))
                    .sort((a, b) => {
                      const capturedDiff =
                        Date.parse(b.captured_at) - Date.parse(a.captured_at);
                      if (capturedDiff !== 0) {
                        return capturedDiff;
                      }
                      return a.evidence_id.localeCompare(b.evidence_id);
                    });
                  return { data: rows, error: null };
                },
              }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
  resetSupabaseClient: () => undefined,
  isSupabaseConfigured: () => true,
}));

describe("GET /api/v1/products/:product_id/evidence", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns evidence in the standard success envelope", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      `/api/v1/products/${SEED_PRODUCT_IDS.tomatoSauce}/evidence`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: {
        evidence: [
          {
            evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06",
            source_type: "SEEDED_REVIEW_SUMMARY",
            summary: expect.any(String),
            quality_signal: "ACCEPTABLE",
            confidence: 0.7,
          },
        ],
      },
      meta: {
        request_id: expect.any(String),
      },
    });
    expect(res.body.data.evidence[0]).not.toHaveProperty("product_id");
    expect(res.body.data.evidence[0]).not.toHaveProperty("sku_id");
    expect(res.body.data.evidence[0]).not.toHaveProperty("expires_at");
  });

  it("returns multiple current evidence records for Farm Eggs", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      `/api/v1/products/${SEED_PRODUCT_IDS.farmEggs}/evidence`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.evidence).toHaveLength(2);
    expect(res.body.data.evidence.map((e: { evidence_id: string }) => e.evidence_id)).toEqual(
      [
        SIX_EGG_SCENARIO.goodTwoPack.evidence_id,
        SIX_EGG_SCENARIO.poorSixPack.evidence_id,
      ],
    );
  });

  it("does not leak another product's evidence", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      `/api/v1/products/${SEED_PRODUCT_IDS.selectEggs}/evidence`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.evidence).toHaveLength(1);
    expect(res.body.data.evidence[0].evidence_id).toBe(
      SIX_EGG_SCENARIO.goodSixPack.evidence_id,
    );
  });

  it("returns an empty evidence array when none exist", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      `/api/v1/products/${SEED_PRODUCT_IDS.sandwichBread}/evidence`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: { evidence: [] },
      meta: { request_id: expect.any(String) },
    });
  });

  it("returns validation error for invalid product UUID", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get("/api/v1/products/not-a-uuid/evidence");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("returns NOT_FOUND for unknown product UUID", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      "/api/v1/products/99999999-9999-4999-8999-999999999999/evidence",
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it("excludes expired evidence from the response", async () => {
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const res = await request(app).get(
      `/api/v1/products/${SEED_PRODUCT_IDS.freshMilk}/evidence`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.evidence).toHaveLength(1);
    expect(res.body.data.evidence[0].evidence_id).toBe(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04",
    );
  });

  it("follows catalog auth conventions (no requireAuth; invalid JWT still 401)", async () => {
    process.env.JWT_SECRET = "test-jwt-secret-for-evidence";
    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    const open = await request(app).get(
      `/api/v1/products/${SEED_PRODUCT_IDS.tomatoSauce}/evidence`,
    );
    expect(open.status).toBe(200);

    const badToken = await request(app)
      .get(`/api/v1/products/${SEED_PRODUCT_IDS.tomatoSauce}/evidence`)
      .set("Authorization", "Bearer not-a-valid-jwt");
    expect(badToken.status).toBe(401);
    expect(badToken.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
  });
});
