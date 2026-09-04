import { describe, it, expect } from "vitest";
import { OllamaClient } from "../../src/ai/ollama/index.js";
import { loadEnv } from "../../src/config/env.js";

describe("OllamaClient", () => {
  it("reads base URL and model from env", () => {
    loadEnv({
      NODE_ENV: "test",
      OLLAMA_BASE_URL: "http://localhost:11434",
      OLLAMA_MODEL: "qwen3:14b",
    });
    const client = new OllamaClient();
    expect(client.baseUrl).toBe("http://localhost:11434");
    expect(client.model).toBe("qwen3:14b");
  });
});
