import { describe, it, expect } from "vitest";
import {
  assertNoIncentiveFields,
  compareDealBestQuality,
  compareDealBestValue,
  compareEffectiveCostPerRequiredUnit,
  evaluateDealEconomics,
  optimizeDeals,
  resolveRealizedDealBenefit,
  type MerchantDealAttachmentInput,
  type PackCombination,
} from "../../src/modules/optimization/index.js";
import { SEED_PRODUCT_IDS, SEED_SKU_IDS } from "../../src/modules/research/seed-fixtures.js";

function line(partial: {
  sku_id: string;
  product_id?: string;
  sku_code?: string;
  pack_count?: number;
  pack_quantity?: number;
  units_per_pack?: number;
  unit_price_minor: number;
  quality_signal?: PackCombination["quality_signal"];
  confidence?: number;
  evidence_refs?: string[];
}): PackCombination["lines"][number] {
  const packCount = partial.pack_count ?? 1;
  const units = partial.units_per_pack ?? partial.pack_quantity ?? 6;
  return {
    sku_id: partial.sku_id,
    product_id: partial.product_id ?? SEED_PRODUCT_IDS.farmEggs,
    sku_code: partial.sku_code ?? "SKU",
    units_per_pack: units,
    pack_count: packCount,
    pack_quantity: partial.pack_quantity ?? units,
    pack_unit: "pieces",
    unit_price_minor: partial.unit_price_minor,
    line_amount_minor: partial.unit_price_minor * packCount,
    quality_signal: partial.quality_signal ?? "GOOD",
    confidence: partial.confidence ?? 0.9,
    evidence_refs: partial.evidence_refs ?? [
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
    ],
  };
}

function combo(
  overrides: Partial<PackCombination> &
    Pick<
      PackCombination,
      "combination_key" | "lines" | "gross_amount_minor" | "quality_signal"
    >,
): PackCombination {
  const covered = overrides.covered_quantity ?? 6;
  const target = overrides.target_quantity ?? 6;
  return {
    target_quantity: target,
    covered_quantity: covered,
    excess_quantity: overrides.excess_quantity ?? Math.max(0, covered - target),
    pack_count_total: overrides.lines.reduce((n, l) => n + l.pack_count, 0),
    currency: "INR",
    confidence: 0.9,
    evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
    assumptions: [],
    feasible: true,
    rejection_reasons: [],
    ...overrides,
  };
}

describe("Phase 5 Step 4 — deal optimization", () => {
  describe("price authority and money", () => {
    it("1–2. uses current authoritative catalog gross in integer paise", () => {
      const combination = combo({
        combination_key: "gross",
        gross_amount_minor: 3600,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.farmEggs2,
            pack_count: 3,
            pack_quantity: 2,
            units_per_pack: 2,
            unit_price_minor: 1200,
          }),
        ],
      });
      const economics = evaluateDealEconomics(combination);
      expect(economics.gross_amount_minor).toBe(3600);
      expect(economics.realized_deal_benefit_minor).toBe(0);
      expect(economics.effective_amount_minor).toBe(3600);
      expect(Number.isInteger(economics.gross_amount_minor)).toBe(true);
      expect(Number.isInteger(economics.effective_amount_minor)).toBe(true);
    });

    it("3. valid ordinary backend deal reduces effective cost", () => {
      const combination = combo({
        combination_key: "deal",
        gross_amount_minor: 8000,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            unit_price_minor: 8000,
          }),
        ],
      });
      const economics = evaluateDealEconomics(combination, {
        deal_type: "BACKEND_REALIZED_SAVING",
        authority: "BACKEND_DEFINED_DEAL",
        realized_benefit_minor: 2000,
        source_reference: "backend:deal:sku-select-eggs",
      });
      expect(economics.gross_amount_minor).toBe(8000);
      expect(economics.realized_deal_benefit_minor).toBe(2000);
      expect(economics.effective_amount_minor).toBe(6000);
    });

    it("8. no floating-point money", () => {
      const resolved = resolveRealizedDealBenefit(8000, {
        deal_type: "BACKEND_REALIZED_SAVING",
        authority: "BACKEND_DEFINED_DEAL",
        realized_benefit_minor: 2000,
        source_reference: "backend:deal:x",
        material_excess_justified: false,
        affected_sku_ids: [],
      });
      expect(Number.isInteger(resolved.effective_amount_minor)).toBe(true);
      expect(resolved.effective_amount_minor).toBe(6000);
    });
  });

  describe("SCENARIO A — no double count", () => {
    it("4. deal benefit is not counted twice", () => {
      const combination = combo({
        combination_key: "a",
        gross_amount_minor: 8000,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            unit_price_minor: 8000,
          }),
        ],
      });
      // Authoritative: price already ₹80; backend realized benefit ₹20 once.
      // list_price present must not add another ₹20.
      const economics = evaluateDealEconomics(combination, {
        deal_type: "BACKEND_REALIZED_SAVING",
        authority: "BACKEND_DEFINED_DEAL",
        realized_benefit_minor: 2000,
        list_price_minor: 10000,
        source_reference: "backend:deal:once",
      });
      expect(economics.effective_amount_minor).toBe(6000);
      expect(economics.effective_amount_minor).not.toBe(4000);
    });
  });

  describe("SCENARIO B — crossed-out / list price", () => {
    it("5. list price does not become a saving without backend authority", () => {
      const combination = combo({
        combination_key: "b",
        gross_amount_minor: 8000,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            unit_price_minor: 8000,
          }),
        ],
      });
      const economics = evaluateDealEconomics(combination, {
        deal_type: "PACK_PRICE",
        authority: "CATALOG_PRICE",
        list_price_minor: 10000,
        source_reference: "catalog:price_minor",
      });
      expect(economics.gross_amount_minor).toBe(8000);
      expect(economics.realized_deal_benefit_minor).toBe(0);
      expect(economics.effective_amount_minor).toBe(8000);
    });

    it("6. authoritative backend-defined saving can be used when explicit", () => {
      const combination = combo({
        combination_key: "b2",
        gross_amount_minor: 8000,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            unit_price_minor: 8000,
          }),
        ],
      });
      const economics = evaluateDealEconomics(combination, {
        deal_type: "BACKEND_REALIZED_SAVING",
        authority: "BACKEND_DEFINED_DEAL",
        realized_benefit_minor: 1500,
        list_price_minor: 10000,
        source_reference: "backend:deal:explicit-saving",
      });
      expect(economics.realized_deal_benefit_minor).toBe(1500);
      expect(economics.effective_amount_minor).toBe(6500);
    });
  });

  describe("unit economics", () => {
    it("7. effective cost per required unit is deterministic", () => {
      const combination = combo({
        combination_key: "unit",
        gross_amount_minor: 3600,
        target_quantity: 6,
        covered_quantity: 6,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.farmEggs2,
            pack_count: 3,
            pack_quantity: 2,
            units_per_pack: 2,
            unit_price_minor: 1200,
          }),
        ],
      });
      const economics = evaluateDealEconomics(combination);
      expect(economics.effective_cost_per_required_unit).toEqual({
        numerator_minor: 3600,
        denominator: 6,
      });
      const cheaper = {
        numerator_minor: 3000,
        denominator: 6,
      };
      expect(
        compareEffectiveCostPerRequiredUnit(
          economics.effective_cost_per_required_unit,
          cheaper,
        ),
      ).toBeGreaterThan(0);
    });
  });

  describe("hard constraints — deal cannot override", () => {
    function infeasible(
      reason: PackCombination["rejection_reasons"][number],
      key: string,
    ): PackCombination {
      return combo({
        combination_key: key,
        gross_amount_minor: 3600,
        quality_signal: "GOOD",
        feasible: false,
        rejection_reasons: [reason],
        lines: [
          line({
            sku_id: SEED_SKU_IDS.farmEggs6,
            unit_price_minor: 3600,
          }),
        ],
      });
    }

    it.each([
      ["9. stock", "OUT_OF_STOCK" as const],
      ["10. inactive SKU", "INACTIVE_SKU" as const],
      ["11. inactive product", "INACTIVE_PRODUCT" as const],
      ["12. category", "CATEGORY_NOT_ALLOWED" as const],
      ["13. exclusion", "EXPLICITLY_EXCLUDED" as const],
    ])("%s failure cannot be overridden by a deal", (_label, reason) => {
      const bad = infeasible(reason, `bad-${reason}`);
      const result = optimizeDeals({
        combinations: [bad],
        deals_by_combination_key: new Map([
          [
            bad.combination_key,
            {
              deal_type: "BACKEND_REALIZED_SAVING",
              authority: "BACKEND_DEFINED_DEAL",
              realized_benefit_minor: 3000,
              source_reference: "backend:deal:should-not-rescue",
            },
          ],
        ]),
        minimum_quality: "ACCEPTABLE",
        budget_minor: 100000,
      });
      expect(result.ranked).toHaveLength(0);
      expect(
        result.rejected.some((r) => r.rejection_reasons.includes(reason)),
      ).toBe(true);
    });

    it("14. deal cannot override minimum quality", () => {
      const poor = combo({
        combination_key: "poor",
        gross_amount_minor: 5000,
        quality_signal: "UNACCEPTABLE",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.farmEggs6,
            unit_price_minor: 5000,
            quality_signal: "UNACCEPTABLE",
          }),
        ],
      });
      const result = optimizeDeals({
        combinations: [poor],
        deals_by_combination_key: new Map([
          [
            "poor",
            {
              deal_type: "BACKEND_REALIZED_SAVING",
              authority: "BACKEND_DEFINED_DEAL",
              realized_benefit_minor: 4000,
              source_reference: "backend:deal:cheap-poor",
            },
          ],
        ]),
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked).toHaveLength(0);
    });

    it("15. deal cannot override budget", () => {
      const expensive = combo({
        combination_key: "exp",
        gross_amount_minor: 12000,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            unit_price_minor: 12000,
          }),
        ],
      });
      const result = optimizeDeals({
        combinations: [expensive],
        deals_by_combination_key: new Map([
          [
            "exp",
            {
              deal_type: "BACKEND_REALIZED_SAVING",
              authority: "BACKEND_DEFINED_DEAL",
              realized_benefit_minor: 500,
              source_reference: "backend:deal:still-over-budget",
            },
          ],
        ]),
        minimum_quality: "ACCEPTABLE",
        budget_minor: 10000,
      });
      // effective 11500 > 10000
      expect(result.ranked).toHaveLength(0);
      expect(
        result.rejected.some((r) =>
          r.rejection_reasons.includes("BUDGET_EXCEEDED"),
        ),
      ).toBe(true);
    });
  });

  describe("SCENARIO C — extra quantity", () => {
    it("16–18. does not add unrelated products; unjustified excess loses", () => {
      const exact = combo({
        combination_key: "exact-6",
        gross_amount_minor: 6000,
        covered_quantity: 6,
        excess_quantity: 0,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.farmEggs6,
            unit_price_minor: 6000,
            pack_quantity: 6,
            units_per_pack: 6,
          }),
        ],
      });
      const oversized = combo({
        combination_key: "excess-12",
        gross_amount_minor: 7000,
        covered_quantity: 12,
        excess_quantity: 6,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: "33333333-3333-4333-8333-3333333333aa",
            product_id: SEED_PRODUCT_IDS.farmEggs,
            unit_price_minor: 7000,
            pack_quantity: 12,
            units_per_pack: 12,
            quality_signal: "GOOD",
          }),
        ],
      });
      // Even if oversized were cheaper, unjustified excess must lose.
      const cheaperExcess = combo({
        ...oversized,
        combination_key: "cheap-excess",
        gross_amount_minor: 5000,
        lines: [
          line({
            sku_id: "33333333-3333-4333-8333-3333333333ab",
            product_id: SEED_PRODUCT_IDS.farmEggs,
            unit_price_minor: 5000,
            pack_quantity: 12,
            units_per_pack: 12,
          }),
        ],
      });
      const result = optimizeDeals({
        combinations: [cheaperExcess, exact],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked[0]!.combination.combination_key).toBe("exact-6");
      expect(result.ranked[0]!.economics.excess_quantity).toBe(0);
    });

    it("19. extra quantity may win when material_excess_justified", () => {
      const exact = combo({
        combination_key: "exact",
        gross_amount_minor: 6000,
        covered_quantity: 6,
        excess_quantity: 0,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.farmEggs6,
            unit_price_minor: 6000,
            pack_quantity: 6,
            units_per_pack: 6,
          }),
        ],
      });
      const justified = combo({
        combination_key: "justified",
        gross_amount_minor: 5000,
        covered_quantity: 12,
        excess_quantity: 6,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: "33333333-3333-4333-8333-3333333333ac",
            product_id: SEED_PRODUCT_IDS.farmEggs,
            unit_price_minor: 5000,
            pack_quantity: 12,
            units_per_pack: 12,
          }),
        ],
      });
      const result = optimizeDeals({
        combinations: [exact, justified],
        deals_by_combination_key: new Map([
          [
            "justified",
            {
              deal_type: "PACK_PRICE",
              authority: "CATALOG_PRICE",
              source_reference: "backend:deal:pack-12-justified",
              material_excess_justified: true,
            },
          ],
        ]),
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked[0]!.combination.combination_key).toBe("justified");
      expect(result.ranked[0]!.economics.material_excess_justified).toBe(true);
    });
  });

  describe("SCENARIO D — quality", () => {
    it("24. higher quality cannot be sacrificed solely for a deal", () => {
      const poorCheap = combo({
        combination_key: "poor-cheap",
        gross_amount_minor: 5000,
        quality_signal: "UNACCEPTABLE",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.farmEggs6,
            unit_price_minor: 5000,
            quality_signal: "UNACCEPTABLE",
          }),
        ],
      });
      const good = combo({
        combination_key: "good",
        gross_amount_minor: 5500,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            product_id: SEED_PRODUCT_IDS.selectEggs,
            unit_price_minor: 5500,
            quality_signal: "GOOD",
          }),
        ],
      });
      const result = optimizeDeals({
        combinations: [poorCheap, good],
        deals_by_combination_key: new Map([
          [
            "poor-cheap",
            {
              deal_type: "BACKEND_REALIZED_SAVING",
              authority: "BACKEND_DEFINED_DEAL",
              realized_benefit_minor: 1000,
              source_reference: "backend:deal:poor",
            },
          ],
        ]),
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked).toHaveLength(1);
      expect(result.ranked[0]!.combination.combination_key).toBe("good");
    });
  });

  describe("SCENARIO E — higher quality made affordable", () => {
    it("25. valid deal can make PREMIUM affordable under BEST_QUALITY", () => {
      const good = combo({
        combination_key: "good-90",
        gross_amount_minor: 9000,
        quality_signal: "GOOD",
        confidence: 0.85,
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            product_id: SEED_PRODUCT_IDS.selectEggs,
            unit_price_minor: 9000,
            quality_signal: "GOOD",
            confidence: 0.85,
          }),
        ],
      });
      const premium = combo({
        combination_key: "premium-105",
        gross_amount_minor: 10500,
        quality_signal: "PREMIUM",
        confidence: 0.85,
        lines: [
          line({
            sku_id: "33333333-3333-4333-8333-3333333333ad",
            product_id: SEED_PRODUCT_IDS.selectEggs,
            unit_price_minor: 10500,
            quality_signal: "PREMIUM",
            confidence: 0.85,
            evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05"],
          }),
        ],
        evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05"],
      });
      const result = optimizeDeals({
        combinations: [good, premium],
        deals_by_combination_key: new Map([
          [
            "premium-105",
            {
              deal_type: "BACKEND_REALIZED_SAVING",
              authority: "BACKEND_DEFINED_DEAL",
              realized_benefit_minor: 1000,
              source_reference: "backend:deal:premium-affordable",
            },
          ],
        ]),
        objective: "BEST_QUALITY",
        minimum_quality: "ACCEPTABLE",
        budget_minor: 10000,
      });
      expect(result.ranked[0]!.combination.combination_key).toBe("premium-105");
      expect(result.ranked[0]!.economics.effective_amount_minor).toBe(9500);
      expect(result.ranked[0]!.quality.quality_signal).toBe("PREMIUM");
    });
  });

  describe("objectives and determinism", () => {
    it("22–23. BEST_VALUE remains cost-oriented; BEST_QUALITY quality-oriented", () => {
      const cheaperGood = combo({
        combination_key: "cheap-good",
        gross_amount_minor: 3600,
        quality_signal: "GOOD",
        confidence: 0.8,
        lines: [
          line({
            sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa71",
            unit_price_minor: 3600,
            quality_signal: "GOOD",
            confidence: 0.8,
          }),
        ],
      });
      const pricierPremium = combo({
        combination_key: "premium",
        gross_amount_minor: 4500,
        quality_signal: "PREMIUM",
        confidence: 0.8,
        lines: [
          line({
            sku_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb71",
            unit_price_minor: 4500,
            quality_signal: "PREMIUM",
            confidence: 0.8,
          }),
        ],
      });
      const value = optimizeDeals({
        combinations: [pricierPremium, cheaperGood],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
        budget_minor: 100000,
      });
      expect(value.ranked[0]!.combination.combination_key).toBe("cheap-good");

      const quality = optimizeDeals({
        combinations: [cheaperGood, pricierPremium],
        objective: "BEST_QUALITY",
        minimum_quality: "ACCEPTABLE",
        budget_minor: 100000,
      });
      expect(quality.ranked[0]!.combination.combination_key).toBe("premium");
    });

    it("20–21. same input / input order independence", () => {
      const a = combo({
        combination_key: "a",
        gross_amount_minor: 4200,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            product_id: SEED_PRODUCT_IDS.selectEggs,
            unit_price_minor: 4200,
          }),
        ],
      });
      const b = combo({
        combination_key: "b",
        gross_amount_minor: 3600,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.farmEggs2,
            pack_count: 3,
            pack_quantity: 2,
            units_per_pack: 2,
            unit_price_minor: 1200,
          }),
        ],
      });
      const first = optimizeDeals({
        combinations: [a, b],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      const second = optimizeDeals({
        combinations: [b, a],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      expect(first.ranked.map((r) => r.combination.combination_key)).toEqual(
        second.ranked.map((r) => r.combination.combination_key),
      );
      expect(first.ranked[0]!.combination.combination_key).toBe("b");
    });
  });

  describe("incentives boundary and evidence", () => {
    it("26–27. voucher/loyalty fields are not consumed", () => {
      expect(() =>
        assertNoIncentiveFields({ voucher_id: "v1" }),
      ).toThrow(/Voucher\/loyalty/);
      expect(() =>
        evaluateDealEconomics(
          combo({
            combination_key: "v",
            gross_amount_minor: 3600,
            quality_signal: "GOOD",
            lines: [
              line({
                sku_id: SEED_SKU_IDS.farmEggs6,
                unit_price_minor: 3600,
              }),
            ],
          }),
          {
            deal_type: "NONE",
            authority: "CATALOG_PRICE",
            source_reference: "catalog:price_minor",
            voucher_decision: "USE_NOW",
          } as MerchantDealAttachmentInput & { voucher_decision: string },
        ),
      ).toThrow(/Voucher\/loyalty/);
    });

    it("28–30. quality evidence and deal authority remain attached", () => {
      const combination = combo({
        combination_key: "ev",
        gross_amount_minor: 8000,
        quality_signal: "GOOD",
        confidence: 0.91,
        evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            product_id: SEED_PRODUCT_IDS.selectEggs,
            unit_price_minor: 8000,
            confidence: 0.91,
            evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03"],
          }),
        ],
      });
      const result = optimizeDeals({
        combinations: [combination],
        deals_by_combination_key: new Map([
          [
            "ev",
            {
              deal_type: "BACKEND_REALIZED_SAVING",
              authority: "BACKEND_DEFINED_DEAL",
              realized_benefit_minor: 500,
              source_reference: "backend:deal:keep-authority",
            },
          ],
        ]),
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked[0]!.quality.quality_signal).toBe("GOOD");
      expect(result.ranked[0]!.quality.evidence_refs).toContain(
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
      );
      expect(result.ranked[0]!.economics.source_reference).toBe(
        "backend:deal:keep-authority",
      );
      expect(result.ranked[0]!.economics.authority).toBe("BACKEND_DEFINED_DEAL");
    });

    it("31–32. missing/invalid deal authority fails closed", () => {
      const combination = combo({
        combination_key: "bad-deal",
        gross_amount_minor: 8000,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: SEED_SKU_IDS.selectEggs6,
            unit_price_minor: 8000,
          }),
        ],
      });
      // realized benefit claimed without BACKEND_REALIZED_SAVING type
      const economics = evaluateDealEconomics(combination, {
        deal_type: "PACK_PRICE",
        authority: "CATALOG_PRICE",
        realized_benefit_minor: 2000,
        source_reference: "catalog:invalid",
      });
      expect(economics.feasible).toBe(false);
      expect(economics.rejection_reasons).toContain("MISSING_AUTHORITATIVE_DATA");

      const result = optimizeDeals({
        combinations: [combination],
        deals_by_combination_key: new Map([
          [
            "bad-deal",
            {
              deal_type: "BACKEND_REALIZED_SAVING",
              authority: "CATALOG_PRICE",
              realized_benefit_minor: 2000,
              source_reference: "invalid-authority",
            },
          ],
        ]),
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked).toHaveLength(0);
    });
  });

  describe("comparators", () => {
    it("compareDealBestValue prefers lower effective amount among justified options", () => {
      const a = {
        combination: combo({
          combination_key: "a",
          gross_amount_minor: 5000,
          quality_signal: "GOOD",
          lines: [
            line({
              sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81",
              unit_price_minor: 5000,
            }),
          ],
        }),
        economics: evaluateDealEconomics(
          combo({
            combination_key: "a",
            gross_amount_minor: 5000,
            quality_signal: "GOOD",
            lines: [
              line({
                sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81",
                unit_price_minor: 5000,
              }),
            ],
          }),
        ),
      };
      const b = {
        combination: combo({
          combination_key: "b",
          gross_amount_minor: 4000,
          quality_signal: "GOOD",
          lines: [
            line({
              sku_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb81",
              unit_price_minor: 4000,
            }),
          ],
        }),
        economics: evaluateDealEconomics(
          combo({
            combination_key: "b",
            gross_amount_minor: 4000,
            quality_signal: "GOOD",
            lines: [
              line({
                sku_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb81",
                unit_price_minor: 4000,
              }),
            ],
          }),
        ),
      };
      expect(compareDealBestValue(b, a)).toBeLessThan(0);
      expect(compareDealBestQuality(b, a)).toBeLessThan(0);
    });
  });
});
