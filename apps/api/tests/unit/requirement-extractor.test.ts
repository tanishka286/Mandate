import { describe, it, expect } from "vitest";
import { DeterministicRequirementExtractor } from "../../src/modules/requirements/deterministic-extractor.js";
import type { ShoppingIntent } from "../../src/modules/intents/schema.js";
import {
  extractedRequirementDraftSchema,
  extractionAssumptionSchema,
  extractionResultSchema,
} from "../../src/modules/requirements/extraction-schema.js";
import { confidenceSchema } from "../../src/modules/requirements/schema.js";

const baseIntent: ShoppingIntent = {
  intent_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
  session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
  mandate_id: "77777777-7777-4777-8777-777777777701",
  goal_text: "",
  category: "grocery",
  budget_minor: null,
  quality_preference: null,
  status: "CREATED",
  assumptions_json: [],
  created_at: "2026-09-05T06:10:00.000Z",
  updated_at: "2026-09-05T06:10:00.000Z",
};

function intent(goal_text: string, overrides: Partial<ShoppingIntent> = {}) {
  return { ...baseIntent, goal_text, ...overrides };
}

describe("DeterministicRequirementExtractor (Phase 3 Step 6 hardening)", async () => {
  const extractor = new DeterministicRequirementExtractor();

  describe("clear inputs", async () => {
    it('extracts "6 eggs" as eggs / 6 / pieces', async () => {
      const result = await extractor.extract(intent("6 eggs"));
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0]).toMatchObject({
        item_name: "eggs",
        target_quantity: 6,
        unit: "pieces",
        confidence: 1,
      });
    });

    it('extracts "2 packs pasta" as pasta / 2 / packs', async () => {
      const result = await extractor.extract(intent("2 packs pasta"));
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0]).toMatchObject({
        item_name: "pasta",
        target_quantity: 2,
        unit: "packs",
        confidence: 1,
      });
      expect(
        result.assumptions.some((a) => a.code === "PASTA_SERVING_PACK_BASIS"),
      ).toBe(false);
    });

    it('extracts "Pasta for 4" with documented pack assumption', async () => {
      const result = await extractor.extract(intent("Pasta for 4"));
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0]).toMatchObject({
        item_name: "pasta",
        target_quantity: 2,
        unit: "packs",
        confidence: 0.94,
        minimum_quality: null,
      });
      const assumption = result.assumptions.find(
        (a) => a.code === "PASTA_SERVING_PACK_BASIS",
      );
      expect(assumption?.detail).toBe("0.5 pack per serving");
      expect(assumption?.source).toMatch(/MVP/);
    });
  });

  describe("budget", async () => {
    it("keeps budget on intent and never creates a budget requirement", async () => {
      const result = await extractor.extract(
        intent("Pasta for 4, budget ₹1000", { budget_minor: 100000 }),
      );
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(
        result.requirements.every((r) => r.item_name !== "budget"),
      ).toBe(true);
      expect(result.assumptions.some((a) => a.code === "BUDGET_ON_INTENT")).toBe(
        true,
      );
    });

    it("does not invent groceries from budget-only text", async () => {
      const result = await extractor.extract(
        intent("Budget ₹1000", { budget_minor: 100000 }),
      );
      expect(result.status).toBe("CLARIFICATION_REQUIRED");
    });
  });

  describe("constraints", async () => {
    it('preserves "brand Farm Fresh" phrase', async () => {
      const result = await extractor.extract(intent("6 eggs, brand Farm Fresh"));
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0].constraints_json).toEqual(
        expect.arrayContaining([{ type: "brand", value: "Farm Fresh" }]),
      );
    });

    it('preserves Title-Case brand in "6 Farm Fresh eggs"', async () => {
      const result = await extractor.extract(intent("6 Farm Fresh eggs"));
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0].constraints_json).toEqual([
        { type: "brand", value: "Farm Fresh" },
      ]);
    });

    it("preserves explicit category constraint", async () => {
      const result = await extractor.extract(
        intent("2 packs pasta category pantry"),
      );
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0].constraints_json).toEqual(
        expect.arrayContaining([{ type: "category", value: "pantry" }]),
      );
    });

    it("preserves explicit exclusion constraint", async () => {
      const result = await extractor.extract(
        intent("6 eggs exclude shellfish"),
      );
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0].constraints_json).toEqual(
        expect.arrayContaining([{ type: "exclusion", value: "shellfish" }]),
      );
    });

    it("does not turn cheap/available into price or stock constraints", async () => {
      const result = await extractor.extract(intent("6 cheap available eggs"));
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0].constraints_json).toEqual([]);
      expect(
        result.assumptions.some(
          (a) => a.code === "NON_AUTHORITATIVE_ADJECTIVES_IGNORED",
        ),
      ).toBe(true);
    });
  });

  describe("ambiguity", async () => {
    it('returns CLARIFICATION_REQUIRED for "something for dinner"', async () => {
      const result = await extractor.extract(intent("something for dinner"));
      expect(result.status).toBe("CLARIFICATION_REQUIRED");
      if (result.status !== "CLARIFICATION_REQUIRED") return;
      expect(result.requirements).toEqual([]);
      expect(result.clarification.question).toBeTruthy();
      expect(result.clarification.reason).toBeTruthy();
    });

    it('returns CLARIFICATION_REQUIRED for "eggs" without quantity', async () => {
      const result = await extractor.extract(intent("eggs"));
      expect(result.status).toBe("CLARIFICATION_REQUIRED");
      if (result.status !== "CLARIFICATION_REQUIRED") return;
      expect(result.clarification.reason).toMatch(/quantity/i);
      expect(result.requirements).toEqual([]);
    });

    it("does not fabricate requirements for incomplete grocery phrases", async () => {
      const result = await extractor.extract(intent("pasta"));
      expect(result.status).toBe("CLARIFICATION_REQUIRED");
      if (result.status !== "CLARIFICATION_REQUIRED") return;
      expect(result.requirements).toEqual([]);
    });
  });

  describe("quality preference", async () => {
    it('maps quality_preference "acceptable" to minimum_quality', async () => {
      const result = await extractor.extract(
        intent("6 eggs", { quality_preference: "acceptable" }),
      );
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0].minimum_quality).toBe("acceptable");
    });

    it("preserves unmapped quality preference as an assumption", async () => {
      const result = await extractor.extract(
        intent("6 eggs", { quality_preference: "premium" }),
      );
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements[0].minimum_quality).toBeNull();
      expect(
        result.assumptions.some((a) => a.code === "QUALITY_PREFERENCE_UNMAPPED"),
      ).toBe(true);
    });
  });

  describe("confidence", async () => {
    it("assigns confidence within [0, 1]", async () => {
      const result = await extractor.extract(intent("6 eggs"));
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      for (const req of result.requirements) {
        expect(confidenceSchema.parse(req.confidence)).toBe(req.confidence);
      }
    });

    it("rejects confidence outside [0, 1] at schema boundary", async () => {
      expect(() => confidenceSchema.parse(1.5)).toThrow();
      expect(() => confidenceSchema.parse(-0.1)).toThrow();
    });
  });

  describe("multiple requirements", async () => {
    it('extracts "6 eggs and 2 packs pasta"', async () => {
      const result = await extractor.extract(intent("6 eggs and 2 packs pasta"));
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") return;
      expect(result.requirements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            item_name: "eggs",
            target_quantity: 6,
            unit: "pieces",
          }),
          expect.objectContaining({
            item_name: "pasta",
            target_quantity: 2,
            unit: "packs",
          }),
        ]),
      );
      expect(result.requirements).toHaveLength(2);
    });

    it("clarifies ambiguous multi-item input instead of partial invention", async () => {
      const result = await extractor.extract(intent("6 eggs and pasta"));
      expect(result.status).toBe("CLARIFICATION_REQUIRED");
      if (result.status !== "CLARIFICATION_REQUIRED") return;
      expect(result.requirements).toEqual([]);
    });
  });

  describe("authority boundaries", async () => {
    it("rejects out-of-scope product/price fields on drafts", async () => {
      expect(() =>
        extractedRequirementDraftSchema.parse({
          item_name: "eggs",
          target_quantity: 6,
          unit: "pieces",
          minimum_quality: null,
          constraints_json: [],
          confidence: 1,
          product_id: "22222222-2222-4222-8222-222222222201",
        }),
      ).toThrow();
      expect(() =>
        extractedRequirementDraftSchema.parse({
          item_name: "eggs",
          target_quantity: 6,
          unit: "pieces",
          minimum_quality: null,
          constraints_json: [],
          confidence: 1,
          sku_id: "33333333-3333-4333-8333-333333333301",
        }),
      ).toThrow();
      expect(() =>
        extractedRequirementDraftSchema.parse({
          item_name: "eggs",
          target_quantity: 6,
          unit: "pieces",
          minimum_quality: null,
          constraints_json: [],
          confidence: 1,
          price_minor: 3600,
        }),
      ).toThrow();
      expect(() =>
        extractedRequirementDraftSchema.parse({
          item_name: "eggs",
          target_quantity: 6,
          unit: "pieces",
          minimum_quality: null,
          constraints_json: [],
          confidence: 1,
          stock: 10,
        }),
      ).toThrow();
      expect(() =>
        extractedRequirementDraftSchema.parse({
          item_name: "eggs",
          target_quantity: 6,
          unit: "pieces",
          minimum_quality: null,
          constraints_json: [],
          confidence: 1,
          policy_decision_id: "99999999-9999-4999-8999-999999999901",
        }),
      ).toThrow();
    });

    it("produces schema-valid ExtractionResult and assumptions", async () => {
      const success = await extractor.extract(intent("6 eggs"));
      expect(extractionResultSchema.parse(success)).toBeTruthy();
      if (success.status === "SUCCESS") {
        for (const a of success.assumptions) {
          expect(extractionAssumptionSchema.parse(a)).toBeTruthy();
        }
      }
      expect(
        extractionResultSchema.parse(
          await extractor.extract(intent("something for dinner")),
        ),
      ).toBeTruthy();
    });
  });
});
