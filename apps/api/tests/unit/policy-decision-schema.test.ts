import { describe, it, expect } from "vitest";
import {
  POLICY_DECISIONS,
  POLICY_VERSION,
  basketIdSchema,
  mandateIdSchema,
  moneyMinorSchema,
  policyDecisionIdSchema,
  policyDecisionOutcomeSchema,
  policyDecisionSchema,
  policyEvaluateHttpBodySchema,
  policyVersionSchema,
  requestIdSchema,
} from "../../src/modules/policy/schema.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { PolicyRepository } from "../../src/modules/policy/repository.js";

const validAllow = {
  policy_decision_id: "88888888-8888-4888-8888-888888888801",
  mandate_id: "77777777-7777-4777-8777-777777777701",
  basket_id: "99999999-9999-4999-8999-999999999901",
  decision: "ALLOW" as const,
  reason_code: "AUTHORIZED",
  gross_amount_minor: 90000,
  discount_amount_minor: 2600,
  final_payable_minor: 87400,
  max_spend_minor: 100000,
  policy_version: "policy-v1",
  evaluated_at: "2026-09-05T12:00:00.000Z",
  request_id: "req-018",
  created_at: "2026-09-05T12:00:00.000Z",
};

const validDeny = {
  ...validAllow,
  policy_decision_id: "88888888-8888-4888-8888-888888888802",
  decision: "DENY" as const,
  reason_code: "MAX_SPEND_EXCEEDED",
  final_payable_minor: 85000,
  max_spend_minor: 80000,
};

describe("policy decision schema validation", () => {
  it("accepts a valid ALLOW decision", () => {
    expect(policyDecisionSchema.parse(validAllow).decision).toBe("ALLOW");
  });

  it("accepts a valid DENY decision with reason_code", () => {
    expect(policyDecisionSchema.parse(validDeny).reason_code).toBe(
      "MAX_SPEND_EXCEEDED",
    );
  });

  it("rejects DENY without reason_code", () => {
    expect(() =>
      policyDecisionSchema.parse({
        ...validDeny,
        reason_code: null,
      }),
    ).toThrow(/reason_code/);
    expect(() =>
      policyDecisionSchema.parse({
        ...validDeny,
        reason_code: "   ",
      }),
    ).toThrow(/reason_code/);
  });

  it("rejects an invalid decision value", () => {
    expect(() => policyDecisionOutcomeSchema.parse("MAYBE")).toThrow();
    expect(() =>
      policyDecisionSchema.parse({
        ...validAllow,
        decision: "PENDING",
      }),
    ).toThrow();
    expect(POLICY_DECISIONS).toEqual(["ALLOW", "DENY"]);
  });

  it("rejects negative money values", () => {
    expect(() => moneyMinorSchema.parse(-1)).toThrow();
    expect(() =>
      policyDecisionSchema.parse({
        ...validAllow,
        gross_amount_minor: -100,
      }),
    ).toThrow();
    expect(() =>
      policyDecisionSchema.parse({
        ...validAllow,
        discount_amount_minor: -1,
      }),
    ).toThrow();
    expect(() =>
      policyDecisionSchema.parse({
        ...validAllow,
        max_spend_minor: -1,
      }),
    ).toThrow();
  });

  it("rejects discount greater than gross", () => {
    expect(() =>
      policyDecisionSchema.parse({
        ...validAllow,
        gross_amount_minor: 1000,
        discount_amount_minor: 1001,
        final_payable_minor: 0,
      }),
    ).toThrow(/discount_amount_minor/);
  });

  it("rejects negative final payable", () => {
    expect(() =>
      policyDecisionSchema.parse({
        ...validAllow,
        final_payable_minor: -1,
      }),
    ).toThrow();
  });

  it("rejects missing policy_version", () => {
    const { policy_version: _removed, ...rest } = validAllow;
    expect(() => policyDecisionSchema.parse(rest)).toThrow();
  });

  it("rejects empty policy_version", () => {
    expect(() => policyVersionSchema.parse("")).toThrow();
    expect(() => policyVersionSchema.parse("   ")).toThrow();
    expect(() =>
      policyDecisionSchema.parse({
        ...validAllow,
        policy_version: "",
      }),
    ).toThrow();
  });

  it("validates UUID references", () => {
    expect(policyDecisionIdSchema.parse(validAllow.policy_decision_id)).toBe(
      validAllow.policy_decision_id,
    );
    expect(mandateIdSchema.parse(validAllow.mandate_id)).toBe(
      validAllow.mandate_id,
    );
    expect(basketIdSchema.parse(validAllow.basket_id)).toBe(
      validAllow.basket_id,
    );
    expect(() => policyDecisionIdSchema.parse("pd-001")).toThrow();
    expect(() =>
      policyDecisionSchema.parse({
        ...validAllow,
        mandate_id: "mandate-001",
      }),
    ).toThrow();
    expect(() =>
      policyDecisionSchema.parse({
        ...validAllow,
        basket_id: "basket-001",
      }),
    ).toThrow();
  });

  it("preserves request_id", () => {
    expect(requestIdSchema.parse("req-018")).toBe("req-018");
    expect(policyDecisionSchema.parse(validAllow).request_id).toBe("req-018");
  });

  it("preserves evaluated_at", () => {
    expect(policyDecisionSchema.parse(validAllow).evaluated_at).toBe(
      "2026-09-05T12:00:00.000Z",
    );
  });

  it("allows ALLOW without a denial reason_code", () => {
    expect(
      policyDecisionSchema.parse({
        ...validAllow,
        reason_code: null,
      }).reason_code,
    ).toBeNull();
  });
});

describe("policyEvaluateHttpBodySchema (Doc 08)", () => {
  const validHttp = {
    mandate_id: "11111111-1111-4111-8111-111111111111",
    basket_id: "22222222-2222-4222-8222-222222222222",
    quote_version: "qv-1",
  };

  it("accepts mandate_id, basket_id, quote_version only", () => {
    expect(policyEvaluateHttpBodySchema.parse(validHttp)).toEqual(validHttp);
  });

  it("rejects unexpected financial and decision fields", () => {
    for (const extra of [
      { price: 10 },
      { final_payable_minor: 1 },
      { decision: "ALLOW" },
      { user_id: "33333333-3333-4333-8333-333333333333" },
      { policy_version: POLICY_VERSION },
    ]) {
      expect(() =>
        policyEvaluateHttpBodySchema.parse({ ...validHttp, ...extra }),
      ).toThrow();
    }
  });
});

describe("policy decision mutation surface", () => {
  it("does not expose AI/service mutation of historical decisions", () => {
    const serviceProto = PolicyService.prototype as Record<string, unknown>;
    const repoProto = PolicyRepository.prototype as Record<string, unknown>;
    const forbidden = [
      "update",
      "updateDecision",
      "updatePolicyDecision",
      "delete",
      "deleteDecision",
      "revoke",
      "overrideDecision",
      "setDecision",
      "mutate",
    ];
    for (const name of forbidden) {
      expect(typeof serviceProto[name]).toBe("undefined");
      expect(typeof repoProto[name]).toBe("undefined");
    }
  });
});
