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
  keep_alive?: string | number;
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatRequest {
  messages: OllamaChatMessage[];
  model?: string;
  stream?: boolean;
  keep_alive?: string | number;
  /** Qwen3 thinking mode — false disables extended reasoning when supported. */
  think?: boolean;
  /** "json" requests JSON-only output from Ollama. */
  format?: "json";
  options?: {
    num_predict?: number;
    temperature?: number;
  };
}

export interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
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
    const env = getEnv();
    const timeoutMs = env.OLLAMA_REQUEST_TIMEOUT_MS;
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model ?? this.model,
        prompt: request.prompt,
        stream: request.stream ?? false,
        keep_alive: request.keep_alive ?? env.OLLAMA_KEEP_ALIVE,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Ollama generate failed with status ${res.status}`);
    }

    return (await res.json()) as OllamaGenerateResponse;
  }

  /**
   * Chat completion — preferred for structured JSON extraction (think:false, format:json).
   */
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const env = getEnv();
    const timeoutMs = env.OLLAMA_REQUEST_TIMEOUT_MS;
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model ?? this.model,
        messages: request.messages,
        stream: request.stream ?? false,
        keep_alive: request.keep_alive ?? env.OLLAMA_KEEP_ALIVE,
        think: request.think,
        format: request.format,
        options: request.options,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Ollama chat failed with status ${res.status}`);
    }

    return (await res.json()) as OllamaChatResponse;
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
