import { describe, it, expect } from "vitest";
import {
  assertNoForbiddenAuthorityFields,
  mapLlmPayloadToExtractionResult,
} from "../../src/modules/requirements/llm-extraction-schema.js";

describe("llm-extraction-schema", () => {
  it("rejects price fields in raw LLM output", () => {
    expect(() =>
      assertNoForbiddenAuthorityFields({
        status: "SUCCESS",
        requirements: [{ item_name: "eggs", price_minor: 1 }],
      }),
    ).toThrow(/forbidden authority/i);
  });

  it("maps SUCCESS payload to extraction result", () => {
    const mapped = mapLlmPayloadToExtractionResult({
      status: "SUCCESS",
      requirements: [
        {
          item_name: "eggs",
          target_quantity: 6,
          unit: "pieces",
          confidence: 0.96,
        },
      ],
      assumptions: [],
    });
    expect(mapped.status).toBe("SUCCESS");
    if (mapped.status !== "SUCCESS") return;
    expect(mapped.requirements[0]).toMatchObject({
      item_name: "eggs",
      target_quantity: 6,
      unit: "pieces",
    });
  });
});
