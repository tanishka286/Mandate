import { getEnv } from "../../config/env.js";
import { logger } from "../../shared/logger/index.js";

/**
 * Ollama client abstraction.
 * Product flows must not treat LLM output as financially authoritative.
 * Phase 6 orchestration uses this client only via StructuredLlmProvider.
 *
 * AI trust boundary:
 * - AI never accesses Supabase / SQL / Razorpay credentials
 * - All AI capabilities must go through backend tool adapters
 */

export interface OllamaClientOptions {
  baseUrl: string;
  model: string;
}

export interface OllamaGenerateRequest {
  prompt: string;
  model?: string;
  stream?: boolean;
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export class OllamaClient {
  readonly baseUrl: string;
  readonly model: string;

  constructor(options?: Partial<OllamaClientOptions>) {
    const env = getEnv();
    this.baseUrl = (options?.baseUrl ?? env.OLLAMA_BASE_URL).replace(/\/$/, "");
    this.model = options?.model ?? env.OLLAMA_MODEL;
  }

  /** Lightweight readiness probe - does not send prompts. */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      logger.debug("Ollama ping failed", { baseUrl: this.baseUrl });
      return false;
    }
  }

  /**
   * Low-level generate call. Intentionally unused by product flows in Phase 0.
   * Callers must never treat LLM output as financially authoritative.
   */
  async generate(
    request: OllamaGenerateRequest,
  ): Promise<OllamaGenerateResponse> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model ?? this.model,
        prompt: request.prompt,
        stream: request.stream ?? false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama generate failed with status ${res.status}`);
    }

    return (await res.json()) as OllamaGenerateResponse;
  }
}

let shared: OllamaClient | null = null;

export function getOllamaClient(): OllamaClient {
  if (!shared) {
    shared = new OllamaClient();
  }
  return shared;
}

export function resetOllamaClient(): void {
  shared = null;
}
