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
    /** When true, use Ollama chat with think:false and format:json (faster extraction). */
    fastStructured?: boolean;
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
    fastStructured?: boolean;
  }): Promise<T> {
    const env = getEnv();
    const maxRetries =
      args.maxRetries ?? env.AGENT_LLM_MAX_RETRIES;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const parsed = args.fastStructured
          ? await this.generateFastStructuredJson(args.system, args.user)
          : await this.generateLegacyStructuredJson(args.system, args.user);
        return parseOrThrow(args.schema, parsed);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("LLM structured generation failed");
  }

  /** Chat API with think:false, format:json, bounded output — for requirement extraction. */
  private async generateFastStructuredJson(
    system: string,
    user: string,
  ): Promise<unknown> {
    const env = getEnv();
    const response = await this.client.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      think: false,
      format: "json",
      options: {
        num_predict: env.OLLAMA_STRUCTURED_NUM_PREDICT,
        temperature: 0,
      },
    });
    return extractJsonObject(response.message.content);
  }

  /** Legacy /generate path for recommendation prose when LLM recommendation is enabled. */
  private async generateLegacyStructuredJson(
    system: string,
    user: string,
  ): Promise<unknown> {
    const prompt = [
      system,
      "",
      "Respond with a single JSON object only. No markdown fences.",
      "",
      user,
    ].join("\n");

    const response = await this.client.generate({ prompt, stream: false });
    return extractJsonObject(response.response);
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
    fastStructured?: boolean;
  }): Promise<T> {
    const raw =
      typeof this.payloads === "function"
        ? this.payloads(args.user)
        : this.payloads.get("default");
    return parseOrThrow(args.schema, raw);
  }
}
