import { z } from "zod";
import type { OllamaClient } from "../../ai/ollama/index.js";
import { getOllamaClient } from "../../ai/ollama/index.js";
import { getEnv } from "../../config/env.js";
import { parseOrThrow } from "../../shared/validation/index.js";

/**
 * Narrow LLM provider port for Phase 6 orchestration.
 * Keeps the orchestrator decoupled from Ollama HTTP internals.
 *
 * LLM may interpret / synthesize / explain.
 * LLM must NOT authorize money, stock, prices, incentives, or policy.
 */
export interface StructuredLlmProvider {
  /**
   * Ask the model for structured JSON and validate with Zod.
   * Retries within a bounded limit on validation failure.
   */
  generateStructured<T>(args: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxRetries?: number;
  }): Promise<T>;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("LLM response did not contain valid JSON");
  }
}

/**
 * Ollama-backed structured LLM adapter.
 * Never treats model output as financial or policy authority.
 */
export class OllamaStructuredLlmProvider implements StructuredLlmProvider {
  constructor(private readonly client: OllamaClient = getOllamaClient()) {}

  async generateStructured<T>(args: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxRetries?: number;
  }): Promise<T> {
    const env = getEnv();
    const maxRetries =
      args.maxRetries ?? env.AGENT_LLM_MAX_RETRIES;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const prompt = [
        args.system,
        "",
        "Respond with a single JSON object only. No markdown fences.",
        "",
        args.user,
      ].join("\n");

      try {
        const response = await this.client.generate({ prompt, stream: false });
        const parsed = extractJsonObject(response.response);
        return parseOrThrow(args.schema, parsed);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("LLM structured generation failed");
  }
}

/**
 * Deterministic stub for tests / offline runs.
 * Never calls the network.
 */
export class StubStructuredLlmProvider implements StructuredLlmProvider {
  constructor(
    private readonly payloads: ReadonlyMap<string, unknown> | ((user: string) => unknown) = () => ({
      summary: "Deterministic recommendation summary.",
      explanation:
        "Best Value meets requirements at lower practical cost; Best Quality is an alternative.",
      tradeoffs: ["Quality vs cost"],
    }),
  ) {}

  async generateStructured<T>(args: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxRetries?: number;
  }): Promise<T> {
    const raw =
      typeof this.payloads === "function"
        ? this.payloads(args.user)
        : this.payloads.get("default");
    return parseOrThrow(args.schema, raw);
  }
}
