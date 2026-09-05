import { describe, it, expect } from "vitest";
import {
  EVIDENCE_SOURCE_TYPES,
  QUALITY_SIGNALS,
  evidenceConfidenceSchema,
  evidenceIdSchema,
  evidenceSourceTypeSchema,
  evidenceSummarySchema,
  productIdSchema,
  qualityEvidenceSchema,
  qualitySignalSchema,
  skuIdSchema,
} from "../../src/modules/research/schema.js";

/** Doc 08 §9.3 evidence fixture shape (UUID ids per project convention). */
const validEvidence = {
  evidence_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee21",
  product_id: "22222222-2222-4222-8222-222222222201",
  sku_id: "33333333-3333-4333-8333-333333333301" as string | null,
  source_type: "SEEDED_REVIEW_SUMMARY" as const,
  source_reference: "seed:farm-eggs-reviews-v1" as string | null,
  summary: "Consistently positive quality signals.",
  quality_signal: "GOOD" as const,
  confidence: 0.86,
  captured_at: "2026-09-05T07:00:00.000Z",
  expires_at: null as string | null,
  created_at: "2026-09-05T07:00:00.000Z",
};

describe("quality evidence schema validation", () => {
  it("accepts valid evidence", () => {
    const parsed = qualityEvidenceSchema.parse(validEvidence);
    expect(parsed.evidence_id).toBe(validEvidence.evidence_id);
    expect(parsed.product_id).toBe(validEvidence.product_id);
    expect(parsed.source_type).toBe("SEEDED_REVIEW_SUMMARY");
    expect(parsed.summary).toBe("Consistently positive quality signals.");
    expect(parsed.quality_signal).toBe("GOOD");
    expect(parsed.confidence).toBe(0.86);
  });

  it("accepts every valid quality level", () => {
    for (const quality_signal of QUALITY_SIGNALS) {
      expect(qualitySignalSchema.parse(quality_signal)).toBe(quality_signal);
      expect(
        qualityEvidenceSchema.parse({ ...validEvidence, quality_signal })
          .quality_signal,
      ).toBe(quality_signal);
    }
  });

  it("rejects invalid quality level", () => {
    expect(() => qualitySignalSchema.parse("EXCELLENT")).toThrow();
    expect(() => qualitySignalSchema.parse("POOR")).toThrow();
    expect(() => qualitySignalSchema.parse("acceptable")).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({
        ...validEvidence,
        quality_signal: "EXCELLENT",
      }),
    ).toThrow();
  });

  it("accepts valid confidence at bounds and mid-range", () => {
    expect(evidenceConfidenceSchema.parse(0)).toBe(0);
    expect(evidenceConfidenceSchema.parse(1)).toBe(1);
    expect(evidenceConfidenceSchema.parse(0.86)).toBe(0.86);
    expect(
      qualityEvidenceSchema.parse({ ...validEvidence, confidence: 0 })
        .confidence,
    ).toBe(0);
    expect(
      qualityEvidenceSchema.parse({ ...validEvidence, confidence: 1 })
        .confidence,
    ).toBe(1);
  });

  it("rejects confidence below minimum", () => {
    expect(() => evidenceConfidenceSchema.parse(-0.01)).toThrow();
    expect(() => evidenceConfidenceSchema.parse(-1)).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({ ...validEvidence, confidence: -0.1 }),
    ).toThrow();
  });

  it("rejects confidence above maximum", () => {
    expect(() => evidenceConfidenceSchema.parse(1.01)).toThrow();
    expect(() => evidenceConfidenceSchema.parse(2)).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({ ...validEvidence, confidence: 1.5 }),
    ).toThrow();
  });

  it("rejects NaN and non-finite confidence", () => {
    expect(() => evidenceConfidenceSchema.parse(Number.NaN)).toThrow();
    expect(() => evidenceConfidenceSchema.parse(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => evidenceConfidenceSchema.parse(Number.NEGATIVE_INFINITY)).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({ ...validEvidence, confidence: Number.NaN }),
    ).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({
        ...validEvidence,
        confidence: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();
  });

  it("rejects missing product/SKU reference (product_id required)", () => {
    expect(() => productIdSchema.parse(undefined)).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({
        ...validEvidence,
        product_id: undefined,
      }),
    ).toThrow();
    const { product_id: _removed, ...withoutProduct } = validEvidence;
    expect(() => qualityEvidenceSchema.parse(withoutProduct)).toThrow();
  });

  it("rejects malformed product_id and evidence_id", () => {
    expect(() => evidenceIdSchema.parse("evidence-21")).toThrow();
    expect(() => productIdSchema.parse("product-1")).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({
        ...validEvidence,
        product_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("allows nullable sku_id but rejects invalid sku_id", () => {
    expect(
      qualityEvidenceSchema.parse({ ...validEvidence, sku_id: null }).sku_id,
    ).toBeNull();
    expect(() => skuIdSchema.parse("sku-1")).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({
        ...validEvidence,
        sku_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("rejects invalid source type", () => {
    expect(() => evidenceSourceTypeSchema.parse("WEB_CRAWL")).toThrow();
    expect(() => evidenceSourceTypeSchema.parse("LLM_INFERENCE")).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({
        ...validEvidence,
        source_type: "UNRESTRICTED_WEB_SEARCH",
      }),
    ).toThrow();
    for (const source_type of EVIDENCE_SOURCE_TYPES) {
      expect(evidenceSourceTypeSchema.parse(source_type)).toBe(source_type);
    }
  });

  it("rejects required-field validation failures", () => {
    expect(() => evidenceSummarySchema.parse("")).toThrow();
    expect(() => evidenceSummarySchema.parse("   ")).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({ ...validEvidence, summary: "" }),
    ).toThrow();
    expect(() =>
      qualityEvidenceSchema.parse({ ...validEvidence, summary: "   " }),
    ).toThrow();

    const { summary: _s, ...withoutSummary } = validEvidence;
    expect(() => qualityEvidenceSchema.parse(withoutSummary)).toThrow();

    const { quality_signal: _q, ...withoutSignal } = validEvidence;
    expect(() => qualityEvidenceSchema.parse(withoutSignal)).toThrow();

    const { confidence: _c, ...withoutConfidence } = validEvidence;
    expect(() => qualityEvidenceSchema.parse(withoutConfidence)).toThrow();

    const { source_type: _t, ...withoutSource } = validEvidence;
    expect(() => qualityEvidenceSchema.parse(withoutSource)).toThrow();

    const { captured_at: _cap, ...withoutCaptured } = validEvidence;
    expect(() => qualityEvidenceSchema.parse(withoutCaptured)).toThrow();

    const { created_at: _cr, ...withoutCreated } = validEvidence;
    expect(() => qualityEvidenceSchema.parse(withoutCreated)).toThrow();
  });

  it("does not accept authoritative commerce or policy fields", () => {
    const forbidden = {
      price_minor: 3600,
      stock: 10,
      category: "dairy",
      mandate_id: "77777777-7777-4777-8777-777777777701",
      final_payable_minor: 87400,
      policy_decision_id: "99999999-9999-4999-8999-999999999901",
    } as const;

    for (const [key, value] of Object.entries(forbidden)) {
      expect(() =>
        qualityEvidenceSchema.parse({
          ...validEvidence,
          [key]: value,
        }),
      ).toThrow();
    }

    const parsed = qualityEvidenceSchema.parse(validEvidence);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "captured_at",
        "confidence",
        "created_at",
        "evidence_id",
        "expires_at",
        "product_id",
        "quality_signal",
        "sku_id",
        "source_reference",
        "source_type",
        "summary",
      ].sort(),
    );
  });
});
