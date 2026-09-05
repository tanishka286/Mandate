import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ErrorCodes } from "../../src/shared/constants/index.js";

const JWT_SECRET = "test-jwt-secret-for-phase7-selection-quote";

const userA = "44444444-4444-4444-8444-444444444401";
const userB = "44444444-4444-4444-8444-444444444402";
const sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const sessionB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const basketValueId = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const basketQualityId = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const skuA = "33333333-3333-4333-8333-333333333301";
const now = "2026-09-05T12:00:00.000Z";

type SessionRow = {
  session_id: string;
  user_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

type RunRow = {
  optimization_run_id: string;
  session_id: string;
  intent_id: string | null;
  mandate_id: string | null;
  status: string;
  candidate_count: number;
  recommendation_json: unknown;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

type BasketRow = {
  basket_id: string;
  optimization_run_id: string;
  session_id: string;
  user_id: string;
  basket_type: string;
  status: string;
  gross_amount_minor: number;
  discount_amount_minor: number;
  final_payable_minor: number;
  currency: string;
  quality_summary: string | null;
  recommendation_reason: string | null;
  explanation: string | null;
  combination_key: string | null;
  state_version: number;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  basket_item_id: string;
  basket_id: string;
  requirement_id: string | null;
  sku_id: string;
  quantity: number;
  unit_price_minor: number;
  line_amount_minor: number;
  quality_level: string | null;
  evidence_refs_json: unknown;
  created_at: string;
  updated_at: string;
};

type SelectionRow = {
  selection_id: string;
  session_id: string;
  basket_id: string;
  user_id: string;
  selection_source: string;
  selected_at: string;
  superseded_at: string | null;
  created_at: string;
};

type QuoteRow = {
  quote_id: string;
  basket_id: string;
  session_id: string;
  user_id: string;
  selection_id: string | null;
  optimization_run_id: string;
  quote_version: string;
  basket_state_version: number;
  currency: string;
  amount_kind: string;
  gross_amount_minor: number;
  discount_amount_minor: number;
  final_payable_minor: number;
  lines_json: unknown;
  applied_incentives_json: unknown;
  catalog_fingerprint: string;
  incentive_fingerprint: string;
  status: string;
  request_id: string | null;
  created_at: string;
  superseded_at: string | null;
};

const sessions = new Map<string, SessionRow>();
const runs = new Map<string, RunRow>();
const baskets = new Map<string, BasketRow>();
const itemsByBasket = new Map<string, ItemRow[]>();
const selections: SelectionRow[] = [];
const quotes: QuoteRow[] = [];
const auditEvents: Array<Record<string, unknown>> = [];
const prices = new Map<string, number>();
const stock = new Map<string, number>();

let selectionSeq = 0;
let quoteSeq = 0;
let auditSeq = 0;

function seed(): void {
  sessions.clear();
  runs.clear();
  baskets.clear();
  itemsByBasket.clear();
  selections.length = 0;
  quotes.length = 0;
  auditEvents.length = 0;
  prices.clear();
  stock.clear();
  selectionSeq = 0;
  quoteSeq = 0;
  auditSeq = 0;

  prices.set(skuA, 10000);
  stock.set(skuA, 100);

  sessions.set(sessionA, {
    session_id: sessionA,
    user_id: userA,
    status: "ACTIVE",
    started_at: now,
    ended_at: null,
    created_at: now,
  });
  sessions.set(sessionB, {
    session_id: sessionB,
    user_id: userB,
    status: "ACTIVE",
    started_at: now,
    ended_at: null,
    created_at: now,
  });

  runs.set(runId, {
    optimization_run_id: runId,
    session_id: sessionA,
    intent_id: null,
    mandate_id: null,
    status: "COMPLETED",
    candidate_count: 2,
    recommendation_json: {
      recommended_basket_type: "BEST_VALUE",
      reason: "Lower cost",
      tradeoff_summary: "Quality costs more",
      incentive_claims: [
        {
          incentive_id: "voucher-001",
          kind: "VOUCHER",
          decision: "USE_NOW",
          validity: "VALID",
          eligibility: "ELIGIBLE",
          benefit_minor: 2000,
        },
      ],
    },
    started_at: now,
    completed_at: now,
    created_at: now,
  });

  baskets.set(basketValueId, {
    basket_id: basketValueId,
    optimization_run_id: runId,
    session_id: sessionA,
    user_id: userA,
    basket_type: "BEST_VALUE",
    status: "CURRENT",
    gross_amount_minor: 20000,
    discount_amount_minor: 2000,
    final_payable_minor: 18000,
    currency: "INR",
    quality_summary: "Good",
    recommendation_reason: null,
    explanation: "Best value",
    combination_key: "bv",
    state_version: 1,
    created_at: now,
    updated_at: now,
  });
  baskets.set(basketQualityId, {
    basket_id: basketQualityId,
    optimization_run_id: runId,
    session_id: sessionA,
    user_id: userA,
    basket_type: "BEST_QUALITY",
    status: "CURRENT",
    gross_amount_minor: 25000,
    discount_amount_minor: 0,
    final_payable_minor: 25000,
    currency: "INR",
    quality_summary: "Excellent",
    recommendation_reason: null,
    explanation: "Best quality",
    combination_key: "bq",
    state_version: 1,
    created_at: now,
    updated_at: now,
  });

  itemsByBasket.set(basketValueId, [
    {
      basket_item_id: "ffffffff-ffff-4fff-8fff-ffffffffff01",
      basket_id: basketValueId,
      requirement_id: null,
      sku_id: skuA,
      quantity: 2,
      unit_price_minor: 10000,
      line_amount_minor: 20000,
      quality_level: "GOOD",
      evidence_refs_json: [],
      created_at: now,
      updated_at: now,
    },
  ]);
  itemsByBasket.set(basketQualityId, [
    {
      basket_item_id: "ffffffff-ffff-4fff-8fff-ffffffffff02",
      basket_id: basketQualityId,
      requirement_id: null,
      sku_id: skuA,
      quantity: 1,
      unit_price_minor: 10000,
      line_amount_minor: 10000,
      quality_level: "EXCELLENT",
      evidence_refs_json: [],
      created_at: now,
      updated_at: now,
    },
  ]);
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
            eq: (_c: string, id: string) => ({
              maybeSingle: async () => ({
                data: sessions.get(id) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "optimization_run") {
        const filter: { id?: string; session_id?: string } = {};
        const api = {
          select: () => api,
          eq: (col: string, val: string) => {
            if (col === "optimization_run_id") filter.id = val;
            if (col === "session_id") filter.session_id = val;
            return api;
          },
          order: () => api,
          limit: () => api,
          maybeSingle: async () => {
            if (filter.id) {
              return { data: runs.get(filter.id) ?? null, error: null };
            }
            if (filter.session_id) {
              const row = [...runs.values()]
                .filter((r) => r.session_id === filter.session_id)
                .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
              return { data: row ?? null, error: null };
            }
            return { data: null, error: null };
          },
        };
        return api;
      }

      if (table === "basket") {
        const filter: {
          basket_id?: string;
          session_id?: string;
          status?: string;
        } = {};
        let updatePayload: Record<string, unknown> | null = null;
        const api = {
          select: () => api,
          update: (row: Record<string, unknown>) => {
            updatePayload = row;
            return api;
          },
          eq: (col: string, val: string) => {
            if (col === "basket_id") filter.basket_id = val;
            if (col === "session_id") filter.session_id = val;
            if (col === "status") filter.status = val;
            return api;
          },
          order: () => ({
            then: async (
              resolve: (v: { data: BasketRow[]; error: null }) => void,
            ) => {
              let rows = [...baskets.values()];
              if (filter.session_id) {
                rows = rows.filter((b) => b.session_id === filter.session_id);
              }
              if (filter.status) {
                rows = rows.filter((b) => b.status === filter.status);
              }
              resolve({ data: rows, error: null });
            },
          }),
          maybeSingle: async () => {
            if (filter.basket_id) {
              return {
                data: baskets.get(filter.basket_id) ?? null,
                error: null,
              };
            }
            return { data: null, error: null };
          },
          single: async () => {
            if (updatePayload && filter.basket_id) {
              const cur = baskets.get(filter.basket_id);
              if (!cur) return { data: null, error: { message: "missing" } };
              const next = { ...cur, ...updatePayload } as BasketRow;
              baskets.set(filter.basket_id, next);
              return { data: next, error: null };
            }
            return { data: null, error: { message: "unsupported" } };
          },
          then: async (
            resolve: (v: { data: null; error: null }) => void,
          ) => {
            if (updatePayload) {
              for (const [id, row] of baskets) {
                if (filter.session_id && row.session_id !== filter.session_id) {
                  continue;
                }
                if (filter.status && row.status !== filter.status) continue;
                if (filter.basket_id && row.basket_id !== filter.basket_id) {
                  continue;
                }
                baskets.set(id, { ...row, ...updatePayload } as BasketRow);
              }
            }
            resolve({ data: null, error: null });
          },
        };
        return api;
      }

      if (table === "basket_item") {
        const filter: { basket_id?: string; sku_id?: string } = {};
        let updatePayload: Record<string, unknown> | null = null;
        const api = {
          select: () => api,
          update: (row: Record<string, unknown>) => {
            updatePayload = row;
            return api;
          },
          eq: (col: string, val: string) => {
            if (col === "basket_id") filter.basket_id = val;
            if (col === "sku_id") filter.sku_id = val;
            return api;
          },
          order: () => ({
            then: async (
              resolve: (v: { data: ItemRow[]; error: null }) => void,
            ) => {
              const rows = filter.basket_id
                ? (itemsByBasket.get(filter.basket_id) ?? [])
                : [];
              resolve({ data: rows, error: null });
            },
          }),
          single: async () => {
            if (!filter.basket_id || !updatePayload) {
              return { data: null, error: { message: "missing" } };
            }
            const list = itemsByBasket.get(filter.basket_id) ?? [];
            const idx = list.findIndex((i) =>
              filter.sku_id ? i.sku_id === filter.sku_id : true,
            );
            if (idx < 0) return { data: null, error: { message: "missing" } };
            const next = { ...list[idx]!, ...updatePayload } as ItemRow;
            list[idx] = next;
            itemsByBasket.set(filter.basket_id, list);
            return { data: next, error: null };
          },
        };
        return api;
      }

      if (table === "basket_selection") {
        const filter: {
          session_id?: string;
          selection_id?: string;
          activeOnly?: boolean;
        } = {};
        let updatePayload: Record<string, unknown> | null = null;
        const api = {
          select: () => api,
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                selectionSeq += 1;
                const stored: SelectionRow = {
                  selection_id: `dddddddd-dddd-4ddd-8ddd-${String(selectionSeq).padStart(12, "0")}`,
                  session_id: String(row.session_id),
                  basket_id: String(row.basket_id),
                  user_id: String(row.user_id),
                  selection_source: String(row.selection_source),
                  selected_at: String(row.selected_at ?? now),
                  superseded_at: null,
                  created_at: now,
                };
                selections.push(stored);
                return { data: stored, error: null };
              },
            }),
          }),
          update: (row: Record<string, unknown>) => {
            updatePayload = row;
            return api;
          },
          eq: (col: string, val: string) => {
            if (col === "session_id") filter.session_id = val;
            if (col === "selection_id") filter.selection_id = val;
            return api;
          },
          is: (col: string, val: unknown) => {
            if (col === "superseded_at" && val === null) {
              filter.activeOnly = true;
            }
            return api;
          },
          maybeSingle: async () => {
            const row = selections.find((s) => {
              if (filter.session_id && s.session_id !== filter.session_id) {
                return false;
              }
              if (filter.activeOnly && s.superseded_at !== null) return false;
              return true;
            });
            return { data: row ?? null, error: null };
          },
          single: async () => {
            if (updatePayload && filter.selection_id) {
              const idx = selections.findIndex(
                (s) => s.selection_id === filter.selection_id,
              );
              if (idx < 0) {
                return { data: null, error: { message: "missing" } };
              }
              selections[idx] = {
                ...selections[idx]!,
                ...updatePayload,
              } as SelectionRow;
              return { data: selections[idx], error: null };
            }
            return { data: null, error: { message: "unsupported" } };
          },
        };
        return api;
      }

      if (table === "basket_quote") {
        const filter: {
          basket_id?: string;
          quote_version?: string;
          status?: string;
          statusIn?: string[];
        } = {};
        let updatePayload: Record<string, unknown> | null = null;

        const applyQuoteUpdate = (): QuoteRow | null => {
          if (!updatePayload || !filter.basket_id) {
            return null;
          }
          let matched: QuoteRow | null = null;
          for (let i = 0; i < quotes.length; i++) {
            const q = quotes[i]!;
            if (q.basket_id !== filter.basket_id) continue;
            if (filter.status && q.status !== filter.status) continue;
            if (
              filter.quote_version &&
              q.quote_version !== filter.quote_version
            ) {
              continue;
            }
            if (filter.statusIn && !filter.statusIn.includes(q.status)) {
              continue;
            }
            const next = { ...q, ...updatePayload } as QuoteRow;
            quotes[i] = next;
            matched = next;
          }
          return matched;
        };

        const api = {
          select: (_cols?: string) => {
            if (updatePayload) {
              return {
                maybeSingle: async () => ({
                  data: applyQuoteUpdate(),
                  error: null,
                }),
              };
            }
            const selectApi = {
              eq: (col: string, val: string) => {
                if (col === "basket_id") filter.basket_id = val;
                if (col === "quote_version") filter.quote_version = val;
                if (col === "status") filter.status = val;
                return selectApi;
              },
              maybeSingle: async () => {
                const row = quotes.find((q) => {
                  if (filter.basket_id && q.basket_id !== filter.basket_id) {
                    return false;
                  }
                  if (
                    filter.quote_version &&
                    q.quote_version !== filter.quote_version
                  ) {
                    return false;
                  }
                  if (filter.status && q.status !== filter.status) return false;
                  if (filter.statusIn && !filter.statusIn.includes(q.status)) {
                    return false;
                  }
                  return true;
                });
                return { data: row ?? null, error: null };
              },
            };
            return selectApi;
          },
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                quoteSeq += 1;
                const stored: QuoteRow = {
                  quote_id: `eeeeeeee-eeee-4eee-8eee-${String(quoteSeq).padStart(12, "0")}`,
                  basket_id: String(row.basket_id),
                  session_id: String(row.session_id),
                  user_id: String(row.user_id),
                  selection_id: (row.selection_id as string | null) ?? null,
                  optimization_run_id: String(row.optimization_run_id),
                  quote_version: String(row.quote_version),
                  basket_state_version: Number(row.basket_state_version),
                  currency: "INR",
                  amount_kind: "AUTHORITATIVE_QUOTE",
                  gross_amount_minor: Number(row.gross_amount_minor),
                  discount_amount_minor: Number(row.discount_amount_minor),
                  final_payable_minor: Number(row.final_payable_minor),
                  lines_json: row.lines_json,
                  applied_incentives_json: row.applied_incentives_json ?? [],
                  catalog_fingerprint: String(row.catalog_fingerprint),
                  incentive_fingerprint: String(row.incentive_fingerprint),
                  status: String(row.status ?? "CURRENT"),
                  request_id: (row.request_id as string | null) ?? null,
                  created_at: now,
                  superseded_at: null,
                };
                quotes.push(stored);
                return { data: stored, error: null };
              },
            }),
          }),
          update: (row: Record<string, unknown>) => {
            updatePayload = row;
            return api;
          },
          eq: (col: string, val: string) => {
            if (col === "basket_id") filter.basket_id = val;
            if (col === "quote_version") filter.quote_version = val;
            if (col === "status") filter.status = val;
            return api;
          },
          in: (col: string, vals: string[]) => {
            if (col === "status") filter.statusIn = vals;
            return api;
          },
          maybeSingle: async () => {
            const row = quotes.find((q) => {
              if (filter.basket_id && q.basket_id !== filter.basket_id) {
                return false;
              }
              if (
                filter.quote_version &&
                q.quote_version !== filter.quote_version
              ) {
                return false;
              }
              if (filter.status && q.status !== filter.status) return false;
              if (filter.statusIn && !filter.statusIn.includes(q.status)) {
                return false;
              }
              return true;
            });
            return { data: row ?? null, error: null };
          },
          then: async (
            resolve: (v: { data: null; error: null }) => void,
          ) => {
            applyQuoteUpdate();
            resolve({ data: null, error: null });
          },
        };
        return api;
      }

      if (table === "sku") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => ({
              then: async (
                resolve: (v: {
                  data: Array<Record<string, unknown>>;
                  error: null;
                }) => void,
              ) => {
                resolve({
                  data: ids.map((sku_id) => ({
                    sku_id,
                    status: "ACTIVE",
                    price_minor: prices.get(sku_id) ?? 0,
                    currency: "INR",
                    product: { status: "ACTIVE" },
                    stock: {
                      available_quantity: stock.get(sku_id) ?? 0,
                    },
                  })),
                  error: null,
                });
              },
            }),
          }),
        };
      }

      if (table === "audit_event") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                auditSeq += 1;
                const stored = {
                  audit_event_id: `ffffffff-ffff-4fff-8fff-${String(auditSeq).padStart(12, "0")}`,
                  ...row,
                  created_at: now,
                };
                auditEvents.push(stored);
                return { data: stored, error: null };
              },
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  }),
  resetSupabaseClient: () => undefined,
  isSupabaseConfigured: () => true,
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

describe("Phase 7 API — basket selection & fresh quote", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    seed();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("1. POST basket selection succeeds", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionA}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({ basket_id: basketValueId, selection_source: "USER" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("SELECTED");
    expect(res.body.data.order_created).toBe(false);
    expect(res.body.data.payment_created).toBe(false);
    expect(res.body.data.policy_decision).toBeNull();
    expect(res.body.meta.request_id).toBeTruthy();
  });

  it("2. cross-user selection rejected", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionB}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(userB)}`)
      .send({ basket_id: basketValueId, selection_source: "USER" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("3. malformed basket ID rejected", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionA}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({ basket_id: "not-a-uuid", selection_source: "USER" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("4–5. selection does not create order or authorize payment", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionA}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({ basket_id: basketValueId, selection_source: "USER" });

    expect(res.status).toBe(201);
    expect(res.body.data.order_created).toBe(false);
    expect(res.body.data.payment_created).toBe(false);
    expect(res.body.data.policy_decision).toBeNull();
  });

  it("6. fresh quote succeeds", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/baskets/${basketValueId}/quote`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.amount_kind).toBe("AUTHORITATIVE_QUOTE");
    expect(res.body.data.quote_version).toMatch(/^quote-/);
    expect(res.body.data.payment_created).toBe(false);
    expect(res.body.data.order_created).toBe(false);
    expect(res.body.data.policy_decision).toBeNull();
  });

  it("7. quote uses server price rather than client price", async () => {
    prices.set(skuA, 15000);
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/baskets/${basketValueId}/quote`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({
        client_claims: {
          unit_prices: { [skuA]: 1 },
          final_payable_minor: 1,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.lines[0].unit_price_minor).toBe(15000);
    expect(res.body.data.gross_amount_minor).toBe(30000);
  });

  it("8. quote uses current stock", async () => {
    stock.set(skuA, 0);
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/baskets/${basketValueId}/quote`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ErrorCodes.STOCK_UNAVAILABLE);
  });

  it("9. quote uses current incentive state", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/baskets/${basketValueId}/quote`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.discount_amount_minor).toBe(2000);
    expect(res.body.data.final_payable_minor).toBe(18000);
  });

  it("10. stale quote rejected", async () => {
    const app = await loadApp();
    const quoted = await request(app)
      .post(`/api/v1/baskets/${basketValueId}/quote`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({});
    expect(quoted.status).toBe(201);

    prices.set(skuA, 20000);
    const { BasketService } = await import(
      "../../src/modules/basket/service.js"
    );
    const service = new BasketService();
    await expect(
      service.resolveQuoteForPolicy({
        user_id: userA,
        basket_id: basketValueId,
        quote_version: quoted.body.data.quote_version,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.QUOTE_STALE });
  });

  it("11. previous selection superseded", async () => {
    const app = await loadApp();
    const first = await request(app)
      .post(`/api/v1/sessions/${sessionA}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({ basket_id: basketValueId, selection_source: "USER" });
    const second = await request(app)
      .post(`/api/v1/sessions/${sessionA}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({ basket_id: basketQualityId, selection_source: "USER" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const prior = selections.find(
      (s) => s.selection_id === first.body.data.selection_id,
    );
    expect(prior?.superseded_at).toBeTruthy();
    expect(second.body.data.basket_id).toBe(basketQualityId);
  });

  it("12. correct API envelope for session baskets", async () => {
    const app = await loadApp();
    const res = await request(app)
      .get(`/api/v1/sessions/${sessionA}/baskets`)
      .set("Authorization", `Bearer ${signToken(userA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.best_value.basket_type).toBe("BEST_VALUE");
    expect(res.body.data.best_quality.basket_type).toBe("BEST_QUALITY");
    expect(res.body.data.recommendation.user_may_select_alternative).toBe(
      true,
    );
    expect(res.body.meta.request_id).toBeTruthy();
  });

  it("13–14. authenticated context required", async () => {
    const app = await loadApp();
    const sel = await request(app)
      .post(`/api/v1/sessions/${sessionA}/basket-selections`)
      .send({ basket_id: basketValueId, selection_source: "USER" });
    const quote = await request(app)
      .post(`/api/v1/baskets/${basketValueId}/quote`)
      .send({});

    expect(sel.status).toBe(401);
    expect(sel.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    expect(quote.status).toBe(401);
    expect(quote.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("security: strict body rejects forged policy ALLOW on selection", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionA}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({
        basket_id: basketValueId,
        selection_source: "USER",
        policy_decision: "ALLOW",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("security: nonexistent basket rejected", async () => {
    const app = await loadApp();
    const res = await request(app)
      .post(`/api/v1/sessions/${sessionA}/basket-selections`)
      .set("Authorization", `Bearer ${signToken(userA)}`)
      .send({
        basket_id: "99999999-9999-4999-8999-999999999999",
        selection_source: "USER",
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
