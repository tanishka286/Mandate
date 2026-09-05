import { describe, it, expect } from "vitest";
import {
  AGENT_TOOL_NAMES,
  FORBIDDEN_AGENT_TOOL_NAMES,
  AgentService,
  createAllowlistedToolRegistry,
  AgentToolRegistry,
  assertAllowlistedOnly,
} from "../../src/modules/agent/index.js";
import { DeterministicRequirementExtractor } from "../../src/modules/requirements/deterministic-extractor.js";
import { loadEnv } from "../../src/config/env.js";

loadEnv({ NODE_ENV: "test" });

describe("Phase 6 — agent tool registry allowlist", () => {
  it("registers exactly the seven allowlisted tools", () => {
    const registry = createAllowlistedToolRegistry();
    expect(registry.list()).toEqual([...AGENT_TOOL_NAMES]);
    assertAllowlistedOnly(registry.list());
  });

  it("rejects registering forbidden tool names", () => {
    const registry = new AgentToolRegistry();
    for (const name of FORBIDDEN_AGENT_TOOL_NAMES) {
      expect(() =>
        registry.register(name as never, async () => ({
          tool: "extract_requirements",
          status: "OK",
        })),
      ).toThrow(/forbidden|allowlisted/i);
    }
  });

  it("rejects invoking forbidden and unknown tools", async () => {
    const service = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      useStubLlm: true,
    });

    for (const name of FORBIDDEN_AGENT_TOOL_NAMES) {
      const result = (await service.invokeTool(name, {})) as {
        status: string;
        error?: { code: string };
      };
      expect(result.status).toBe("ERROR");
      expect(result.error?.code).toBe("TOOL_FORBIDDEN");
    }

    const unknown = (await service.invokeTool("database_query", {
      sql: "SELECT * FROM mandates",
    })) as { status: string; error?: { code: string } };
    expect(unknown.status).toBe("ERROR");
    expect(["TOOL_FORBIDDEN", "TOOL_NOT_ALLOWLISTED"]).toContain(
      unknown.error?.code,
    );
  });

  it("proves agent has no mandate/price/stock/payment/checkout tools", () => {
    const listed = createAllowlistedToolRegistry().list();
    const banned = [
      "mandate_update",
      "price_update",
      "stock_update",
      "checkout",
      "razorpay",
      "payment_verification",
      "sql",
      "orm",
      "database_query",
    ];
    for (const name of banned) {
      expect(listed).not.toContain(name);
    }
  });

  it("AgentService surface has no payment or mandate mutation methods", () => {
    const service = new AgentService({ useStubLlm: true });
    const proto = Object.getOwnPropertyNames(
      Object.getPrototypeOf(service),
    );
    expect(proto).not.toContain("updateMandate");
    expect(proto).not.toContain("setPrice");
    expect(proto).not.toContain("setStock");
    expect(proto).not.toContain("createRazorpayOrder");
    expect(proto).not.toContain("markPaymentSuccessful");
    expect(proto).not.toContain("checkout");
    expect(proto).toContain("runPlanning");
    expect(proto).toContain("listTools");
    expect(proto).toContain("invokeTool");
  });
});

describe("Phase 6 — agent can use allowlisted capabilities", () => {
  it("extract_requirements works via deterministic extractor", async () => {
    const service = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      useStubLlm: true,
    });
    const result = (await service.invokeTool("extract_requirements", {
      goal_text: "6 eggs",
    })) as {
      status: string;
      data: { status: string; requirements: Array<{ item_name: string; target_quantity: number; unit: string }> };
    };
    expect(result.status).toBe("OK");
    expect(result.data.status).toBe("SUCCESS");
    expect(result.data.requirements[0]).toMatchObject({
      item_name: "eggs",
      target_quantity: 6,
      unit: "pieces",
    });
  });

  it("extract_requirements asks for clarification on ambiguous goals", async () => {
    const service = new AgentService({
      extractor: new DeterministicRequirementExtractor(),
      useStubLlm: true,
    });
    const result = (await service.invokeTool("extract_requirements", {
      goal_text: "something nice for dinner maybe",
    })) as { status: string; data: { status: string } };
    expect(result.status).toBe("OK");
    expect(result.data.status).toBe("CLARIFICATION_REQUIRED");
  });
});
