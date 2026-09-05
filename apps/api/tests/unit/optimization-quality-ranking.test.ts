import { describe, it, expect } from "vitest";
import {
  QUALITY_SIGNAL_RANK,
  compareBestQualityCombinations,
  compareBestValueCombinations,
  evaluateHardMinimumQuality,
  normalizeQualityRankingView,
  optimizePackCombinations,
  rankQualityAwareCombinations,
  toPackCandidateInput,
  toQualityRank,
  type OptimizationCandidate,
  type PackCombination,
  type PackQualitySnapshot,
} from "../../src/modules/optimization/index.js";
import {
  SEED_PRODUCT_IDS,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";

function quality(
  signal: PackQualitySnapshot["quality_signal"],
  overrides: Partial<PackQualitySnapshot> = {},
): PackQualitySnapshot {
  return {
    quality_signal: signal,
    confidence: 0.9,
    evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01"],
    evidence_status: signal === null ? "NONE" : "SUFFICIENT",
    meets_minimum_quality:
      signal === null ? false : signal !== "UNACCEPTABLE",
    ...overrides,
  };
}

function candidate(
  overrides: Partial<OptimizationCandidate> &
    Pick<
      OptimizationCandidate,
      "product_id" | "sku_id" | "product_name" | "sku_code"
    >,
): OptimizationCandidate {
  return {
    brand: null,
    category_code: "dairy",
    product_status: "ACTIVE",
    sku_status: "ACTIVE",
    pack_quantity: 6,
    pack_unit: "pieces",
    price_minor: 3600,
    currency: "INR",
    stock_available: 24,
    ...overrides,
  };
}

const eggsRequirement = {
  item_name: "eggs",
  target_quantity: 6,
  unit: "pieces",
  minimum_quality: "ACCEPTABLE",
  constraints_json: [] as unknown[],
};

const candidateA = candidate({
  product_id: SIX_EGG_SCENARIO.poorSixPack.product_id,
  sku_id: SIX_EGG_SCENARIO.poorSixPack.sku_id,
  product_name: "Farm Eggs",
  brand: "FarmFresh",
  sku_code: SIX_EGG_SCENARIO.poorSixPack.sku_code,
  pack_quantity: 6,
  price_minor: SIX_EGG_SCENARIO.poorSixPack.price_minor,
});

const candidateB = candidate({
  product_id: SIX_EGG_SCENARIO.goodSixPack.product_id,
  sku_id: SIX_EGG_SCENARIO.goodSixPack.sku_id,
  product_name: "Select Eggs",
  brand: "Select",
  sku_code: SIX_EGG_SCENARIO.goodSixPack.sku_code,
  pack_quantity: 6,
  price_minor: SIX_EGG_SCENARIO.goodSixPack.price_minor,
  stock_available: 30,
});

const candidateC = candidate({
  product_id: SIX_EGG_SCENARIO.goodTwoPack.product_id,
  sku_id: SIX_EGG_SCENARIO.goodTwoPack.sku_id,
  product_name: "Farm Eggs",
  brand: "FarmFresh",
  sku_code: SIX_EGG_SCENARIO.goodTwoPack.sku_code,
  pack_quantity: 2,
  price_minor: SIX_EGG_SCENARIO.goodTwoPack.price_minor,
  stock_available: 48,
});

const qualityA = quality("UNACCEPTABLE", {
  evidence_refs: [SIX_EGG_SCENARIO.poorSixPack.evidence_id],
  meets_minimum_quality: false,
  confidence: 0.92,
});
const qualityB = quality("GOOD", {
  evidence_refs: [SIX_EGG_SCENARIO.goodSixPack.evidence_id],
  meets_minimum_quality: true,
  confidence: 0.9,
});
const qualityC = quality("GOOD", {
  evidence_refs: [SIX_EGG_SCENARIO.goodTwoPack.evidence_id],
  meets_minimum_quality: true,
  confidence: 0.88,
});

function combo(overrides: Partial<PackCombination> & Pick<PackCombination, "combination_key" | "lines" | "gross_amount_minor" | "quality_signal">): PackCombination {
  return {
    target_quantity: 6,
    covered_quantity: 6,
    excess_quantity: 0,
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

function line(partial: {
  sku_id: string;
  product_id?: string;
  sku_code?: string;
  pack_count?: number;
  pack_quantity?: number;
  units_per_pack?: number;
  unit_price_minor: number;
  quality_signal: PackCombination["quality_signal"];
  confidence?: number;
  evidence_refs?: string[];
}): PackCombination["lines"][number] {
  const packCount = partial.pack_count ?? 1;
  return {
    sku_id: partial.sku_id,
    product_id: partial.product_id ?? SEED_PRODUCT_IDS.farmEggs,
    sku_code: partial.sku_code ?? "SKU",
    units_per_pack: partial.units_per_pack ?? 6,
    pack_count: packCount,
    pack_quantity: partial.pack_quantity ?? 6,
    pack_unit: "pieces",
    unit_price_minor: partial.unit_price_minor,
    line_amount_minor: partial.unit_price_minor * packCount,
    quality_signal: partial.quality_signal,
    confidence: partial.confidence ?? 0.9,
    evidence_refs: partial.evidence_refs ?? [
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
    ],
  };
}

describe("Phase 5 Step 3 — quality-aware ranking", () => {
  describe("18. quality mapping is deterministic", () => {
    it("uses locked UNACCEPTABLE < ACCEPTABLE < GOOD < PREMIUM", () => {
      expect(QUALITY_SIGNAL_RANK.UNACCEPTABLE).toBeLessThan(
        QUALITY_SIGNAL_RANK.ACCEPTABLE,
      );
      expect(QUALITY_SIGNAL_RANK.ACCEPTABLE).toBeLessThan(
        QUALITY_SIGNAL_RANK.GOOD,
      );
      expect(QUALITY_SIGNAL_RANK.GOOD).toBeLessThan(QUALITY_SIGNAL_RANK.PREMIUM);
      expect(toQualityRank(null)).toBe(-1);
      expect(toQualityRank("PREMIUM")).toBe(3);
    });
  });

  describe("hard minimum quality", () => {
    it("1. rejects UNACCEPTABLE when minimum is ACCEPTABLE", () => {
      const result = evaluateHardMinimumQuality("UNACCEPTABLE", "ACCEPTABLE");
      expect(result.meets).toBe(false);
      expect(result.rejection_reasons).toContain("REQUIREMENT_NOT_FULFILLED");
    });

    it("2. accepts ACCEPTABLE at minimum", () => {
      expect(evaluateHardMinimumQuality("ACCEPTABLE", "ACCEPTABLE").meets).toBe(
        true,
      );
    });

    it("3. accepts GOOD", () => {
      expect(evaluateHardMinimumQuality("GOOD", "ACCEPTABLE").meets).toBe(true);
    });

    it("4. accepts PREMIUM (locked top level; not EXCELLENT)", () => {
      expect(evaluateHardMinimumQuality("PREMIUM", "ACCEPTABLE").meets).toBe(
        true,
      );
    });

    it("11. missing evidence does not fabricate a positive signal", () => {
      const view = normalizeQualityRankingView({
        quality_signal: null,
        confidence: 0,
        evidence_refs: [],
        evidence_status: "NONE",
        minimum_quality: "ACCEPTABLE",
      });
      expect(view.quality_signal).toBeNull();
      expect(view.quality_rank).toBe(-1);
      expect(view.meets_minimum_quality).toBe(false);
      expect(evaluateHardMinimumQuality(null, "ACCEPTABLE").meets).toBe(false);
    });
  });

  describe("canonical six-egg quality ranking", () => {
    it("rejects A; C wins over B on lower gross with equal GOOD quality", () => {
      const packResult = optimizePackCombinations(
        eggsRequirement,
        [
          toPackCandidateInput(candidateA, qualityA),
          toPackCandidateInput(candidateB, qualityB),
          toPackCandidateInput(candidateC, qualityC),
        ],
        { allowed_categories: ["dairy"] },
      );

      const ranked = rankQualityAwareCombinations({
        combinations: [
          ...packResult.ranked,
          ...packResult.rejected_combinations,
        ],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });

      expect(
        ranked.rejected.some(
          (row) =>
            row.combination.lines.some(
              (l) => l.sku_id === candidateA.sku_id,
            ) ||
            packResult.ineligible.some(
              (i) => i.candidate?.sku_id === candidateA.sku_id,
            ),
        ) ||
          packResult.ineligible.some(
            (i) => i.candidate?.sku_id === candidateA.sku_id,
          ),
      ).toBe(true);

      const winner = ranked.ranked[0]!;
      expect(winner.combination.lines[0]!.sku_id).toBe(candidateC.sku_id);
      expect(winner.combination.lines[0]!.pack_count).toBe(3);
      expect(winner.combination.covered_quantity).toBe(6);
      expect(winner.combination.gross_amount_minor).toBe(3600);
      expect(winner.quality.quality_signal).toBe("GOOD");
      expect(winner.quality.evidence_refs).toContain(
        SIX_EGG_SCENARIO.goodTwoPack.evidence_id,
      );
      expect(Number.isInteger(winner.combination.gross_amount_minor)).toBe(
        true,
      );
    });
  });

  describe("ranking trade-offs", () => {
    it("5. better quality does not override a hard budget violation", () => {
      const premium = combo({
        combination_key: "premium",
        gross_amount_minor: 5000,
        quality_signal: "PREMIUM",
        confidence: 0.99,
        lines: [
          line({
            sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
            unit_price_minor: 5000,
            quality_signal: "PREMIUM",
          }),
        ],
      });
      const good = combo({
        combination_key: "good",
        gross_amount_minor: 3600,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
            unit_price_minor: 3600,
            quality_signal: "GOOD",
          }),
        ],
      });
      const result = rankQualityAwareCombinations({
        combinations: [premium, good],
        objective: "BEST_QUALITY",
        minimum_quality: "ACCEPTABLE",
        budget_minor: 4000,
      });
      expect(result.ranked).toHaveLength(1);
      expect(result.ranked[0]!.combination.combination_key).toBe("good");
      expect(
        result.rejected.some((r) =>
          r.rejection_reasons.includes("BUDGET_EXCEEDED"),
        ),
      ).toBe(true);
    });

    it("6. cheaper unacceptable cannot beat acceptable", () => {
      const cheapBad = combo({
        combination_key: "cheap-bad",
        gross_amount_minor: 1000,
        quality_signal: "UNACCEPTABLE",
        lines: [
          line({
            sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02",
            unit_price_minor: 1000,
            quality_signal: "UNACCEPTABLE",
          }),
        ],
      });
      const ok = combo({
        combination_key: "ok",
        gross_amount_minor: 4200,
        quality_signal: "ACCEPTABLE",
        lines: [
          line({
            sku_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02",
            unit_price_minor: 4200,
            quality_signal: "ACCEPTABLE",
          }),
        ],
      });
      const result = rankQualityAwareCombinations({
        combinations: [cheapBad, ok],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked).toHaveLength(1);
      expect(result.ranked[0]!.combination.combination_key).toBe("ok");
    });

    it("7. equal quality + lower cost ranks first (BEST_VALUE)", () => {
      const low = combo({
        combination_key: "low",
        gross_amount_minor: 3600,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
            unit_price_minor: 3600,
            quality_signal: "GOOD",
          }),
        ],
      });
      const high = combo({
        combination_key: "high",
        gross_amount_minor: 4200,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
            unit_price_minor: 4200,
            quality_signal: "GOOD",
          }),
        ],
      });
      expect(compareBestValueCombinations(low, high)).toBeLessThan(0);
      const result = rankQualityAwareCombinations({
        combinations: [high, low],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked[0]!.combination.combination_key).toBe("low");
    });

    it("8. equal cost + higher quality ranks first", () => {
      const acceptable = combo({
        combination_key: "acc",
        gross_amount_minor: 3600,
        quality_signal: "ACCEPTABLE",
        lines: [
          line({
            sku_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11",
            unit_price_minor: 3600,
            quality_signal: "ACCEPTABLE",
          }),
        ],
      });
      const good = combo({
        combination_key: "good",
        gross_amount_minor: 3600,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: "ffffffff-ffff-4fff-8fff-ffffffffff01",
            unit_price_minor: 3600,
            quality_signal: "GOOD",
          }),
        ],
      });
      expect(compareBestValueCombinations(good, acceptable)).toBeLessThan(0);
      const result = rankQualityAwareCombinations({
        combinations: [acceptable, good],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked[0]!.quality.quality_signal).toBe("GOOD");
    });

    it("9. equal cost + equal quality → lower excess ranks first", () => {
      const exact = combo({
        combination_key: "exact",
        gross_amount_minor: 4800,
        quality_signal: "GOOD",
        covered_quantity: 6,
        excess_quantity: 0,
        lines: [
          line({
            sku_id: candidateC.sku_id,
            pack_count: 3,
            pack_quantity: 2,
            units_per_pack: 2,
            unit_price_minor: 1600,
            quality_signal: "GOOD",
          }),
        ],
      });
      const excess = combo({
        combination_key: "excess",
        gross_amount_minor: 4800,
        quality_signal: "GOOD",
        covered_quantity: 8,
        excess_quantity: 2,
        lines: [
          line({
            sku_id: candidateC.sku_id,
            pack_count: 4,
            pack_quantity: 2,
            units_per_pack: 2,
            unit_price_minor: 1200,
            quality_signal: "GOOD",
          }),
        ],
      });
      expect(compareBestValueCombinations(exact, excess)).toBeLessThan(0);
    });

    it("10. equal cost/quality/excess → deterministic SKU ordering", () => {
      const a = combo({
        combination_key: "a",
        gross_amount_minor: 4000,
        quality_signal: "GOOD",
        confidence: 0.9,
        lines: [
          line({
            sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99",
            unit_price_minor: 4000,
            quality_signal: "GOOD",
          }),
        ],
      });
      const b = combo({
        combination_key: "b",
        gross_amount_minor: 4000,
        quality_signal: "GOOD",
        confidence: 0.9,
        lines: [
          line({
            sku_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb99",
            unit_price_minor: 4000,
            quality_signal: "GOOD",
          }),
        ],
      });
      const result = rankQualityAwareCombinations({
        combinations: [b, a],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      expect(result.ranked[0]!.combination.lines[0]!.sku_id).toBe(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99",
      );
    });
  });

  describe("evidence preservation and authority", () => {
    it("12–14. preserves confidence, evidence refs; currentness via Phase 4 status", () => {
      const combination = combo({
        combination_key: "ev",
        gross_amount_minor: 4200,
        quality_signal: "GOOD",
        confidence: 0.91,
        evidence_refs: [SIX_EGG_SCENARIO.goodSixPack.evidence_id],
        lines: [
          line({
            sku_id: candidateB.sku_id,
            product_id: candidateB.product_id,
            unit_price_minor: 4200,
            quality_signal: "GOOD",
            confidence: 0.91,
            evidence_refs: [SIX_EGG_SCENARIO.goodSixPack.evidence_id],
          }),
        ],
      });
      const statusMap = new Map([
        ["ev", "SUFFICIENT" as const],
      ]);
      const result = rankQualityAwareCombinations({
        combinations: [combination],
        minimum_quality: "ACCEPTABLE",
        evidence_status_by_key: statusMap,
      });
      expect(result.ranked[0]!.quality.confidence).toBe(0.91);
      expect(result.ranked[0]!.quality.evidence_refs).toEqual([
        SIX_EGG_SCENARIO.goodSixPack.evidence_id,
      ]);
      expect(result.ranked[0]!.quality.evidence_status).toBe("SUFFICIENT");
    });

    it("15. free-text summary does not affect ranking (strict combo schema)", () => {
      expect(() =>
        rankQualityAwareCombinations({
          combinations: [
            {
              ...combo({
                combination_key: "text",
                gross_amount_minor: 3600,
                quality_signal: "GOOD",
                lines: [
                  line({
                    sku_id: candidateC.sku_id,
                    unit_price_minor: 3600,
                    quality_signal: "GOOD",
                  }),
                ],
              }),
              // @ts-expect-error summary must never be authority
              summary: "This is the best eggs ever",
            },
          ],
          minimum_quality: "ACCEPTABLE",
        }),
      ).toThrow();
    });
  });

  describe("determinism", () => {
    it("16–17. same input / input order independence", () => {
      const low = combo({
        combination_key: "c-low",
        gross_amount_minor: 3600,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: candidateC.sku_id,
            pack_count: 3,
            pack_quantity: 2,
            units_per_pack: 2,
            unit_price_minor: 1200,
            quality_signal: "GOOD",
          }),
        ],
      });
      const high = combo({
        combination_key: "b-high",
        gross_amount_minor: 4200,
        quality_signal: "GOOD",
        lines: [
          line({
            sku_id: candidateB.sku_id,
            unit_price_minor: 4200,
            quality_signal: "GOOD",
          }),
        ],
      });
      const a = rankQualityAwareCombinations({
        combinations: [high, low],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      const b = rankQualityAwareCombinations({
        combinations: [low, high],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
      });
      expect(a.ranked.map((r) => r.combination.combination_key)).toEqual(
        b.ranked.map((r) => r.combination.combination_key),
      );
      expect(a.ranked.map((r) => r.combination.combination_key)).toEqual([
        "c-low",
        "b-high",
      ]);
    });

    it("19–20. integer money only; no random ranking", () => {
      const result = rankQualityAwareCombinations({
        combinations: [
          combo({
            combination_key: "money",
            gross_amount_minor: 3600,
            quality_signal: "GOOD",
            lines: [
              line({
                sku_id: candidateC.sku_id,
                pack_count: 3,
                pack_quantity: 2,
                units_per_pack: 2,
                unit_price_minor: 1200,
                quality_signal: "GOOD",
              }),
            ],
          }),
        ],
        minimum_quality: "ACCEPTABLE",
      });
      const g = result.ranked[0]!.combination.gross_amount_minor;
      expect(Number.isInteger(g)).toBe(true);
      expect(g).toBe(3600);
    });
  });

  describe("BEST_QUALITY primitive (no basket generation)", () => {
    it("prefers higher quality before lower cost", () => {
      const cheaperGood = combo({
        combination_key: "cheap-good",
        gross_amount_minor: 3600,
        quality_signal: "GOOD",
        confidence: 0.8,
        lines: [
          line({
            sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa55",
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
            sku_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb55",
            unit_price_minor: 4500,
            quality_signal: "PREMIUM",
            confidence: 0.8,
          }),
        ],
      });
      expect(
        compareBestQualityCombinations(pricierPremium, cheaperGood),
      ).toBeLessThan(0);
      const valueOrder = rankQualityAwareCombinations({
        combinations: [pricierPremium, cheaperGood],
        objective: "BEST_VALUE",
        minimum_quality: "ACCEPTABLE",
        budget_minor: 100000,
      });
      expect(valueOrder.ranked[0]!.combination.combination_key).toBe(
        "cheap-good",
      );
      const qualityOrder = rankQualityAwareCombinations({
        combinations: [cheaperGood, pricierPremium],
        objective: "BEST_QUALITY",
        minimum_quality: "ACCEPTABLE",
        budget_minor: 100000,
      });
      expect(qualityOrder.ranked[0]!.combination.combination_key).toBe(
        "premium",
      );
    });
  });
});
