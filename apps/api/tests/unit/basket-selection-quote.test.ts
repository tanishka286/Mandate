import { describe, it, expect, beforeEach, vi } from "vitest";
import { BasketService } from "../../src/modules/basket/service.js";
import { AuditService } from "../../src/modules/audit/service.js";
import type { BasketRepository } from "../../src/modules/basket/repository.js";
import type { SessionsRepository } from "../../src/modules/sessions/repository.js";
import type {
  BasketItemRow,
  BasketQuoteRow,
  BasketRow,
  BasketSelectionRow,
  CatalogSkuLoadRow,
  OptimizationRunRow,
} from "../../src/modules/basket/types.js";
import type { ShoppingSessionRow } from "../../src/modules/sessions/types.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { AppError } from "../../src/shared/errors/index.js";
import {
  deriveCatalogFingerprint,
  deriveIncentiveFingerprint,
} from "../../src/modules/basket/service.js";

const userA = "44444444-4444-4444-8444-444444444401";
const userB = "44444444-4444-4444-8444-444444444402";
const sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const sessionB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const basketValueId = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const basketQualityId = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const basketOtherRunId = "cccccccc-cccc-4ccc-8ccc-cccccccccc03";
const skuA = "33333333-3333-4333-8333-333333333301";
const skuB = "33333333-3333-4333-8333-333333333302";

const now = "2026-09-05T12:00:00.000Z";

function sessionRow(
  overrides: Partial<ShoppingSessionRow> = {},
): ShoppingSessionRow {
  return {
    session_id: sessionA,
    user_id: userA,
    status: "ACTIVE",
    started_at: now,
    ended_at: null,
    created_at: now,
    ...overrides,
  };
}

function runRow(overrides: Partial<OptimizationRunRow> = {}): OptimizationRunRow {
  return {
    optimization_run_id: runId,
    session_id: sessionA,
    intent_id: null,
    mandate_id: null,
    status: "COMPLETED",
    candidate_count: 2,
    recommendation_json: {
      recommended_basket_type: "BEST_VALUE",
      reason: "Lower practical cost",
      tradeoff_summary: "Quality costs more",
      user_may_select_alternative: true,
      incentive_claims: [],
    },
    started_at: now,
    completed_at: now,
    created_at: now,
    ...overrides,
  };
}

function basketRow(overrides: Partial<BasketRow> = {}): BasketRow {
  return {
    basket_id: basketValueId,
    optimization_run_id: runId,
    session_id: sessionA,
    user_id: userA,
    basket_type: "BEST_VALUE",
    status: "CURRENT",
    gross_amount_minor: 20000,
    discount_amount_minor: 0,
    final_payable_minor: 20000,
    currency: "INR",
    quality_summary: "Good",
    recommendation_reason: null,
    explanation: "Best value explanation",
    combination_key: "bv-key",
    state_version: 1,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function itemRow(overrides: Partial<BasketItemRow> = {}): BasketItemRow {
  return {
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
    ...overrides,
  };
}

function catalogRow(
  overrides: Partial<CatalogSkuLoadRow> = {},
): CatalogSkuLoadRow {
  return {
    sku_id: skuA,
    price_minor: 10000,
    currency: "INR",
    available_quantity: 100,
    sku_status: "ACTIVE",
    product_status: "ACTIVE",
    ...overrides,
  };
}

type Store = {
  sessions: Map<string, ShoppingSessionRow>;
  runs: Map<string, OptimizationRunRow>;
  baskets: Map<string, BasketRow>;
  items: Map<string, BasketItemRow[]>;
  selections: BasketSelectionRow[];
  quotes: BasketQuoteRow[];
  catalog: Map<string, CatalogSkuLoadRow>;
};

function createStore(): Store {
  const store: Store = {
    sessions: new Map([
      [sessionA, sessionRow()],
      [
        sessionB,
        sessionRow({ session_id: sessionB, user_id: userB }),
      ],
    ]),
    runs: new Map([[runId, runRow()]]),
    baskets: new Map([
      [basketValueId, basketRow()],
      [
        basketQualityId,
        basketRow({
          basket_id: basketQualityId,
          basket_type: "BEST_QUALITY",
          gross_amount_minor: 25000,
          final_payable_minor: 25000,
          explanation: "Best quality explanation",
          combination_key: "bq-key",
        }),
      ],
      [
        basketOtherRunId,
        basketRow({
          basket_id: basketOtherRunId,
          optimization_run_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb99",
          status: "CURRENT",
        }),
      ],
    ]),
    items: new Map([
      [basketValueId, [itemRow()]],
      [
        basketQualityId,
        [
          itemRow({
            basket_item_id: "ffffffff-ffff-4fff-8fff-ffffffffff02",
            basket_id: basketQualityId,
            sku_id: skuB,
            quantity: 1,
            unit_price_minor: 25000,
            line_amount_minor: 25000,
          }),
        ],
      ],
      [basketOtherRunId, [itemRow({ basket_id: basketOtherRunId })]],
    ]),
    selections: [],
    quotes: [],
    catalog: new Map([
      [skuA, catalogRow()],
      [skuB, catalogRow({ sku_id: skuB, price_minor: 25000 })],
    ]),
  };
  return store;
}

function createRepos(store: Store): {
  basketRepo: BasketRepository;
  sessionsRepo: SessionsRepository;
} {
  let runSeq = 0;
  let basketSeq = 0;
  let itemSeq = 0;
  let selectionSeq = 0;
  let quoteSeq = 0;

  const basketRepo = {
    findOptimizationRunById: async (id: string) => store.runs.get(id) ?? null,
    findLatestOptimizationRunForSession: async (sid: string) => {
      const runs = [...store.runs.values()]
        .filter((r) => r.session_id === sid)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return runs[0] ?? null;
    },
    insertOptimizationRun: async (input: {
      session_id: string;
      intent_id?: string | null;
      mandate_id?: string | null;
      status?: string;
      candidate_count?: number;
      recommendation_json?: unknown;
      completed_at?: string | null;
    }) => {
      runSeq += 1;
      const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(runSeq).padStart(12, "0")}`;
      const row = runRow({
        optimization_run_id: id,
        session_id: input.session_id,
        intent_id: input.intent_id ?? null,
        mandate_id: input.mandate_id ?? null,
        status: input.status ?? "COMPLETED",
        candidate_count: input.candidate_count ?? 0,
        recommendation_json: input.recommendation_json ?? null,
        completed_at: input.completed_at ?? now,
        created_at: `2026-09-05T12:00:${String(runSeq).padStart(2, "0")}.000Z`,
      });
      store.runs.set(id, row);
      return row;
    },
    supersedeCurrentBasketsForSession: async (sid: string) => {
      for (const [id, b] of store.baskets) {
        if (b.session_id === sid && b.status === "CURRENT") {
          store.baskets.set(id, { ...b, status: "SUPERSEDED" });
        }
      }
    },
    insertBasket: async (input: Record<string, unknown>) => {
      basketSeq += 1;
      const id =
        (input.basket_id as string | undefined) ??
        `cccccccc-cccc-4ccc-8ccc-${String(basketSeq).padStart(12, "0")}`;
      const row = basketRow({
        basket_id: id,
        optimization_run_id: input.optimization_run_id as string,
        session_id: input.session_id as string,
        user_id: input.user_id as string,
        basket_type: input.basket_type as string,
        status: (input.status as string) ?? "CURRENT",
        gross_amount_minor: (input.gross_amount_minor as number) ?? 0,
        discount_amount_minor: (input.discount_amount_minor as number) ?? 0,
        final_payable_minor: (input.final_payable_minor as number) ?? 0,
        quality_summary: (input.quality_summary as string | null) ?? null,
        recommendation_reason:
          (input.recommendation_reason as string | null) ?? null,
        explanation: (input.explanation as string | null) ?? null,
        combination_key: (input.combination_key as string | null) ?? null,
        state_version: (input.state_version as number) ?? 1,
      });
      store.baskets.set(id, row);
      store.items.set(id, []);
      return row;
    },
    insertBasketItem: async (input: Record<string, unknown>) => {
      itemSeq += 1;
      const id = `ffffffff-ffff-4fff-8fff-${String(itemSeq).padStart(12, "0")}`;
      const row = itemRow({
        basket_item_id: id,
        basket_id: input.basket_id as string,
        requirement_id: (input.requirement_id as string | null) ?? null,
        sku_id: input.sku_id as string,
        quantity: input.quantity as number,
        unit_price_minor: (input.unit_price_minor as number) ?? 0,
        line_amount_minor: (input.line_amount_minor as number) ?? 0,
        quality_level: (input.quality_level as string | null) ?? null,
        evidence_refs_json: input.evidence_refs_json ?? [],
      });
      const list = store.items.get(row.basket_id) ?? [];
      list.push(row);
      store.items.set(row.basket_id, list);
      return row;
    },
    findBasketById: async (id: string) => store.baskets.get(id) ?? null,
    listCurrentBasketsForSession: async (sid: string) =>
      [...store.baskets.values()].filter(
        (b) => b.session_id === sid && b.status === "CURRENT",
      ),
    listBasketItems: async (bid: string) => store.items.get(bid) ?? [],
    replaceBasketItemQuantity: async (input: {
      basket_id: string;
      sku_id: string;
      quantity: number;
      next_state_version: number;
    }) => {
      const list = store.items.get(input.basket_id) ?? [];
      const idx = list.findIndex((i) => i.sku_id === input.sku_id);
      if (idx < 0) {
        throw new Error("item missing");
      }
      const updated = { ...list[idx]!, quantity: input.quantity, updated_at: now };
      list[idx] = updated;
      store.items.set(input.basket_id, list);
      const basket = store.baskets.get(input.basket_id)!;
      store.baskets.set(input.basket_id, {
        ...basket,
        state_version: input.next_state_version,
        updated_at: now,
      });
      return updated;
    },
    findActiveSelectionForSession: async (sid: string) =>
      store.selections.find(
        (s) => s.session_id === sid && s.superseded_at === null,
      ) ?? null,
    supersedeSelection: async (id: string, supersededAt: string) => {
      const idx = store.selections.findIndex((s) => s.selection_id === id);
      const row = { ...store.selections[idx]!, superseded_at: supersededAt };
      store.selections[idx] = row;
      return row;
    },
    insertSelection: async (input: {
      session_id: string;
      basket_id: string;
      user_id: string;
      selection_source: string;
      selected_at?: string;
    }) => {
      selectionSeq += 1;
      const row: BasketSelectionRow = {
        selection_id: `dddddddd-dddd-4ddd-8ddd-${String(selectionSeq).padStart(12, "0")}`,
        session_id: input.session_id,
        basket_id: input.basket_id,
        user_id: input.user_id,
        selection_source: input.selection_source,
        selected_at: input.selected_at ?? now,
        superseded_at: null,
        created_at: now,
      };
      store.selections.push(row);
      return row;
    },
    findQuoteByBasketAndVersion: async (bid: string, version: string) =>
      store.quotes.find(
        (q) => q.basket_id === bid && q.quote_version === version,
      ) ?? null,
    findCurrentQuoteForBasket: async (bid: string) =>
      store.quotes.find((q) => q.basket_id === bid && q.status === "CURRENT") ??
      null,
    markQuotesStaleOrSuperseded: async (
      bid: string,
      status: "SUPERSEDED" | "STALE",
    ) => {
      store.quotes = store.quotes.map((q) =>
        q.basket_id === bid && q.status === "CURRENT"
          ? { ...q, status, superseded_at: now }
          : q,
      );
    },
    insertQuote: async (input: Record<string, unknown>) => {
      quoteSeq += 1;
      const row: BasketQuoteRow = {
        quote_id: `eeeeeeee-eeee-4eee-8eee-${String(quoteSeq).padStart(12, "0")}`,
        basket_id: input.basket_id as string,
        session_id: input.session_id as string,
        user_id: input.user_id as string,
        selection_id: (input.selection_id as string | null) ?? null,
        optimization_run_id: input.optimization_run_id as string,
        quote_version: input.quote_version as string,
        basket_state_version: input.basket_state_version as number,
        currency: "INR",
        amount_kind: "AUTHORITATIVE_QUOTE",
        gross_amount_minor: input.gross_amount_minor as number,
        discount_amount_minor: input.discount_amount_minor as number,
        final_payable_minor: input.final_payable_minor as number,
        lines_json: input.lines_json,
        applied_incentives_json: input.applied_incentives_json ?? [],
        catalog_fingerprint: input.catalog_fingerprint as string,
        incentive_fingerprint: input.incentive_fingerprint as string,
        status: (input.status as string) ?? "CURRENT",
        request_id: (input.request_id as string | null) ?? null,
        created_at: now,
        superseded_at: null,
      };
      store.quotes.push(row);
      return row;
    },
    loadCatalogSnapshots: async (skuIds: readonly string[]) =>
      skuIds
        .map((id) => store.catalog.get(id))
        .filter((row): row is CatalogSkuLoadRow => Boolean(row)),
    extractIncentiveClaims: (recommendationJson: unknown) => {
      if (
        !recommendationJson ||
        typeof recommendationJson !== "object" ||
        !("incentive_claims" in recommendationJson)
      ) {
        return [];
      }
      const claims = (recommendationJson as { incentive_claims?: unknown })
        .incentive_claims;
      return Array.isArray(claims) ? claims : [];
    },
  } as unknown as BasketRepository;

  const sessionsRepo = {
    findById: async (id: string) => store.sessions.get(id) ?? null,
  } as unknown as SessionsRepository;

  return { basketRepo, sessionsRepo };
}

describe("Phase 7 — BasketService selection & quote", () => {
  let store: Store;
  let service: BasketService;

  beforeEach(() => {
    store = createStore();
    const { basketRepo, sessionsRepo } = createRepos(store);
    service = new BasketService(basketRepo, sessionsRepo);
  });

  it("1. valid basket selection", async () => {
    const result = await service.selectBasket(userA, sessionA, {
      basket_id: basketValueId,
      selection_source: "USER",
    });
    expect(result.status).toBe("SELECTED");
    expect(result.basket_id).toBe(basketValueId);
    expect(result.order_created).toBe(false);
    expect(result.payment_created).toBe(false);
    expect(result.policy_decision).toBeNull();
  });

  it("2. invalid selection source rejected", async () => {
    await expect(
      service.selectBasket(userA, sessionA, {
        basket_id: basketValueId,
        selection_source: "AI",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("3. cross-user basket selection rejected", async () => {
    await expect(
      service.selectBasket(userB, sessionB, {
        basket_id: basketValueId,
        selection_source: "USER",
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      service.selectBasket(userB, sessionB, {
        basket_id: basketValueId,
        selection_source: "USER",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN });
  });

  it("4. basket from wrong session rejected", async () => {
    await expect(
      service.selectBasket(userA, sessionA, {
        basket_id: basketValueId,
        selection_source: "USER",
      }),
    ).resolves.toBeTruthy();

    // Move basket to another session ownership path: wrong session id in request
    store.baskets.set(
      basketQualityId,
      basketRow({
        basket_id: basketQualityId,
        session_id: sessionB,
        user_id: userA,
        basket_type: "BEST_QUALITY",
      }),
    );
    await expect(
      service.selectBasket(userA, sessionA, {
        basket_id: basketQualityId,
        selection_source: "USER",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN });
  });

  it("5. superseding previous selection", async () => {
    const first = await service.selectBasket(userA, sessionA, {
      basket_id: basketValueId,
      selection_source: "USER",
    });
    const second = await service.selectBasket(userA, sessionA, {
      basket_id: basketQualityId,
      selection_source: "USER",
    });
    expect(second.basket_id).toBe(basketQualityId);
    const prior = store.selections.find(
      (s) => s.selection_id === first.selection_id,
    );
    expect(prior?.superseded_at).toBeTruthy();
    expect(second.superseded_at).toBeNull();
  });

  it("6. fresh quote calculation", async () => {
    const quote = await service.createFreshQuote(userA, basketValueId, {});
    expect(quote.gross_amount_minor).toBe(20000);
    expect(quote.final_payable_minor).toBe(20000);
    expect(quote.amount_kind).toBe("AUTHORITATIVE_QUOTE");
    expect(quote.policy_decision).toBeNull();
    expect(quote.payment_created).toBe(false);
    expect(quote.order_created).toBe(false);
    expect(quote.quote_version.startsWith("quote-")).toBe(true);
  });

  it("6b. fresh quote emits FRESH_QUOTE audit event", async () => {
    const auditSpy = vi
      .spyOn(AuditService.prototype, "recordFreshQuote")
      .mockResolvedValue(undefined);

    const quote = await service.createFreshQuote(
      userA,
      basketValueId,
      {},
      "req-fresh-quote-audit",
    );

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userA,
        session_id: sessionA,
        basket_id: basketValueId,
        request_id: "req-fresh-quote-audit",
      }),
      expect.objectContaining({
        basket_id: basketValueId,
        quote_version: quote.quote_version,
        gross_amount_minor: quote.gross_amount_minor,
        discount_amount_minor: quote.discount_amount_minor,
        final_payable_minor: quote.final_payable_minor,
        basket_state_version: 1,
      }),
    );

    auditSpy.mockRestore();
  });

  it("7. price change causes fresh price", async () => {
    store.catalog.set(skuA, catalogRow({ price_minor: 12000 }));
    const quote = await service.createFreshQuote(userA, basketValueId, {});
    expect(quote.lines[0]?.unit_price_minor).toBe(12000);
    expect(quote.final_payable_minor).toBe(24000);
  });

  it("8. stock disappearance", async () => {
    store.catalog.set(skuA, catalogRow({ available_quantity: 0 }));
    await expect(
      service.createFreshQuote(userA, basketValueId, {}),
    ).rejects.toMatchObject({ code: ErrorCodes.STOCK_UNAVAILABLE });
  });

  it("9. voucher expiry/recalculation", async () => {
    store.runs.set(
      runId,
      runRow({
        recommendation_json: {
          recommended_basket_type: "BEST_VALUE",
          incentive_claims: [
            {
              incentive_id: "voucher-001",
              kind: "VOUCHER",
              decision: "USE_NOW",
              validity: "VALID",
              eligibility: "ELIGIBLE",
              benefit_minor: 5000,
              valid_until: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );
    const quote = await service.createFreshQuote(userA, basketValueId, {});
    expect(quote.discount_amount_minor).toBe(0);
    expect(quote.final_payable_minor).toBe(20000);
  });

  it("10. negative payable rejected via invalid incentive overshoot", async () => {
    store.runs.set(
      runId,
      runRow({
        recommendation_json: {
          incentive_claims: [
            {
              incentive_id: "voucher-big",
              kind: "VOUCHER",
              decision: "USE_NOW",
              validity: "VALID",
              eligibility: "ELIGIBLE",
              benefit_minor: 50000,
            },
          ],
        },
      }),
    );
    await expect(
      service.createFreshQuote(userA, basketValueId, {}),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("11. integer minor-unit arithmetic", async () => {
    store.catalog.set(skuA, catalogRow({ price_minor: 87400 }));
    store.items.set(basketValueId, [itemRow({ quantity: 1 })]);
    const quote = await service.createFreshQuote(userA, basketValueId, {});
    expect(Number.isInteger(quote.final_payable_minor)).toBe(true);
    expect(quote.final_payable_minor).toBe(87400);
  });

  it("12. client amount ignored", async () => {
    const quote = await service.createFreshQuote(userA, basketValueId, {
      client_claims: {
        final_payable_minor: 1,
        gross_amount_minor: 1,
        discount_amount_minor: 999999,
      },
    });
    expect(quote.final_payable_minor).toBe(20000);
    expect(quote.gross_amount_minor).toBe(20000);
  });

  it("13. quote version creation", async () => {
    const quote = await service.createFreshQuote(userA, basketValueId, {});
    expect(quote.quote_id).toBeTruthy();
    expect(quote.quote_version).toMatch(/^quote-[a-f0-9]{16}$/);
    expect(quote.basket_state_version).toBe(1);
    expect(quote.catalog_fingerprint).toHaveLength(24);
  });

  it("14. stale quote detection", async () => {
    const quote = await service.createFreshQuote(userA, basketValueId, {});
    store.catalog.set(skuA, catalogRow({ price_minor: 15000 }));
    await expect(
      service.resolveQuoteForPolicy({
        user_id: userA,
        basket_id: basketValueId,
        quote_version: quote.quote_version,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.QUOTE_STALE });
  });

  it("15. basket mutation invalidates old quote", async () => {
    const quote = await service.createFreshQuote(userA, basketValueId, {});
    await service.mutateBasketItemQuantity(userA, basketValueId, skuA, 5);
    await expect(
      service.resolveQuoteForPolicy({
        user_id: userA,
        basket_id: basketValueId,
        quote_version: quote.quote_version,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.QUOTE_STALE });
  });

  it("selection does not belong to current optimization run", async () => {
    await expect(
      service.selectBasket(userA, sessionA, {
        basket_id: basketOtherRunId,
        selection_source: "USER",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT });
  });

  it("fingerprint helpers are deterministic", () => {
    const rows = [catalogRow(), catalogRow({ sku_id: skuB, price_minor: 1 })];
    expect(deriveCatalogFingerprint(rows)).toBe(
      deriveCatalogFingerprint([...rows].reverse()),
    );
    expect(
      deriveIncentiveFingerprint([
        {
          incentive_id: "a",
          kind: "VOUCHER",
          decision: "USE_NOW",
          validity: "VALID",
          eligibility: "ELIGIBLE",
          benefit_minor: 100,
        },
      ]),
    ).toHaveLength(24);
  });

  it("materializeOptimizationBaskets persists dual baskets", async () => {
    const result = await service.materializeOptimizationBaskets(userA, {
      session_id: sessionA,
      best_value: {
        basket_type: "BEST_VALUE",
        items: [{ sku_id: skuA, quantity: 1, unit_price_minor: 1000 }],
        explanation: "value",
      },
      best_quality: {
        basket_type: "BEST_QUALITY",
        items: [{ sku_id: skuB, quantity: 1, unit_price_minor: 2000 }],
        explanation: "quality",
      },
      recommendation: {
        recommended_basket_type: "BEST_VALUE",
        reason: "cheaper",
        tradeoff_summary: "quality costs more",
      },
    });
    expect(result.best_value).toBeTruthy();
    expect(result.best_quality).toBeTruthy();
    expect(result.recommendation?.user_may_select_alternative).toBe(true);
  });
});
