import { describe, it, expect } from "vitest";
import { ResearchService } from "../../src/modules/research/service.js";
import type { ResearchRepository } from "../../src/modules/research/repository.js";
import type { QualityEvidenceRow } from "../../src/modules/research/types.js";
import {
  isCurrentEvidence,
  qualityEvidenceSchema,
} from "../../src/modules/research/schema.js";
import {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
  SEEDED_QUALITY_EVIDENCE,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";

function toRow(
  fixture: (typeof SEEDED_QUALITY_EVIDENCE)[number],
): QualityEvidenceRow {
  return {
    evidence_id: fixture.evidence_id,
    product_id: fixture.product_id,
    sku_id: fixture.sku_id,
    source_type: fixture.source_type,
    source_reference: fixture.source_reference,
    summary: fixture.summary,
    quality_signal: fixture.quality_signal,
    confidence: fixture.confidence,
    captured_at: fixture.captured_at,
    expires_at: fixture.expires_at,
    created_at: fixture.created_at,
  };
}

const allRows = SEEDED_QUALITY_EVIDENCE.map(toRow);

function createRepository(
  overrides: Partial<ResearchRepository> = {},
): ResearchRepository {
  return {
    findById: async () => null,
    listByProductId: async (productId: string) =>
      allRows.filter((row) => row.product_id === productId),
    productExists: async (productId: string) =>
      Object.values(SEED_PRODUCT_IDS).includes(
        productId as (typeof SEED_PRODUCT_IDS)[keyof typeof SEED_PRODUCT_IDS],
      ),
    ...overrides,
  } as ResearchRepository;
}

describe("ResearchService.getProductEvidence", () => {
  const now = new Date("2026-09-05T12:00:00.000Z");

  it("returns a single evidence record for tomato sauce", async () => {
    const service = new ResearchService(createRepository());
    const result = await service.getProductEvidence(
      SEED_PRODUCT_IDS.tomatoSauce,
      now,
    );

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06",
      source_type: "SEEDED_REVIEW_SUMMARY",
      quality_signal: "ACCEPTABLE",
      confidence: 0.7,
    });
  });

  it("returns all current evidence for a product with multiple records", async () => {
    const service = new ResearchService(createRepository());
    const result = await service.getProductEvidence(
      SEED_PRODUCT_IDS.farmEggs,
      now,
    );

    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.map((e) => e.evidence_id)).toEqual([
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
    ]);
  });

  it("never returns evidence belonging to another product", async () => {
    const service = new ResearchService(createRepository());
    const result = await service.getProductEvidence(
      SEED_PRODUCT_IDS.selectEggs,
      now,
    );

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.evidence_id).toBe(
      SIX_EGG_SCENARIO.goodSixPack.evidence_id,
    );
    expect(
      result.evidence.every(
        (item) =>
          !SEEDED_QUALITY_EVIDENCE.some(
            (seed) =>
              seed.evidence_id === item.evidence_id &&
              seed.product_id !== SEED_PRODUCT_IDS.selectEggs,
          ),
      ),
    ).toBe(true);
  });

  it("returns an empty array when a valid product has no evidence", async () => {
    const service = new ResearchService(createRepository());
    const result = await service.getProductEvidence(
      SEED_PRODUCT_IDS.sandwichBread,
      now,
    );

    expect(result).toEqual({ evidence: [] });
  });

  it("rejects invalid product UUID", async () => {
    const service = new ResearchService(createRepository());
    await expect(
      service.getProductEvidence("not-a-uuid", now),
    ).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
    });
  });

  it("returns NOT_FOUND for unknown product UUID", async () => {
    const service = new ResearchService(createRepository());
    await expect(
      service.getProductEvidence(
        "99999999-9999-4999-8999-999999999999",
        now,
      ),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      service.getProductEvidence(
        "99999999-9999-4999-8999-999999999999",
        now,
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      statusCode: 404,
    });
  });

  it("excludes expired evidence from research retrieval", async () => {
    const service = new ResearchService(createRepository());
    const result = await service.getProductEvidence(
      SEED_PRODUCT_IDS.freshMilk,
      now,
    );

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.evidence_id).toBe(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04",
    );
    expect(
      result.evidence.some(
        (item) => item.evidence_id === "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee08",
      ),
    ).toBe(false);
  });

  it("orders evidence by newest captured_at then evidence_id", async () => {
    const service = new ResearchService(createRepository());
    const result = await service.getProductEvidence(
      SEED_PRODUCT_IDS.durumPasta,
      now,
    );

    expect(result.evidence.map((e) => e.evidence_id)).toEqual([
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee07",
    ]);
  });

  it("does not fabricate quality conclusions for empty evidence", async () => {
    const service = new ResearchService(createRepository());
    const result = await service.getProductEvidence(
      SEED_PRODUCT_IDS.sandwichBread,
      now,
    );

    expect(result.evidence).toEqual([]);
    expect(result).not.toHaveProperty("quality_signal");
    expect(result).not.toHaveProperty("confidence");
  });
});

describe("seeded quality evidence fixtures", () => {
  it("are schema-valid and reproducible", () => {
    for (const fixture of SEEDED_QUALITY_EVIDENCE) {
      expect(() => qualityEvidenceSchema.parse(fixture)).not.toThrow();
    }
    expect(SEEDED_QUALITY_EVIDENCE).toHaveLength(8);
  });

  it("covers locked quality levels and confidence differences", () => {
    const signals = new Set(
      SEEDED_QUALITY_EVIDENCE.map((row) => row.quality_signal),
    );
    expect(signals).toEqual(
      new Set(["UNACCEPTABLE", "ACCEPTABLE", "GOOD", "PREMIUM"]),
    );
    const confidences = new Set(
      SEEDED_QUALITY_EVIDENCE.map((row) => row.confidence),
    );
    expect(confidences.size).toBeGreaterThan(1);
  });

  it("maps the six-egg scenario to the correct product/SKU prices", () => {
    expect(SIX_EGG_SCENARIO.poorSixPack.price_minor).toBe(3600);
    expect(SIX_EGG_SCENARIO.goodSixPack.price_minor).toBe(4200);
    expect(SIX_EGG_SCENARIO.goodTwoPack.price_minor).toBe(1200);
    expect(SIX_EGG_SCENARIO.goodTwoPack.price_minor * 3).toBe(3600);

    expect(SIX_EGG_SCENARIO.poorSixPack.sku_id).toBe(SEED_SKU_IDS.farmEggs6);
    expect(SIX_EGG_SCENARIO.goodTwoPack.sku_id).toBe(SEED_SKU_IDS.farmEggs2);
    expect(SIX_EGG_SCENARIO.goodSixPack.sku_id).toBe(SEED_SKU_IDS.selectEggs6);

    const poor = SEEDED_QUALITY_EVIDENCE.find(
      (row) => row.evidence_id === SIX_EGG_SCENARIO.poorSixPack.evidence_id,
    );
    const goodSix = SEEDED_QUALITY_EVIDENCE.find(
      (row) => row.evidence_id === SIX_EGG_SCENARIO.goodSixPack.evidence_id,
    );
    const goodTwo = SEEDED_QUALITY_EVIDENCE.find(
      (row) => row.evidence_id === SIX_EGG_SCENARIO.goodTwoPack.evidence_id,
    );

    expect(poor?.quality_signal).toBe("UNACCEPTABLE");
    expect(poor?.sku_id).toBe(SEED_SKU_IDS.farmEggs6);
    expect(goodSix?.quality_signal).toBe("GOOD");
    expect(goodSix?.product_id).toBe(SEED_PRODUCT_IDS.selectEggs);
    expect(goodTwo?.quality_signal).toBe("GOOD");
    expect(goodTwo?.sku_id).toBe(SEED_SKU_IDS.farmEggs2);
  });
});

describe("isCurrentEvidence", () => {
  const now = new Date("2026-09-05T12:00:00.000Z");

  it("treats null expires_at as current", () => {
    expect(isCurrentEvidence(null, now)).toBe(true);
  });

  it("excludes expired timestamps", () => {
    expect(isCurrentEvidence("2025-06-01T00:00:00.000Z", now)).toBe(false);
  });

  it("includes future expires_at", () => {
    expect(isCurrentEvidence("2027-01-01T00:00:00.000Z", now)).toBe(true);
  });
});
