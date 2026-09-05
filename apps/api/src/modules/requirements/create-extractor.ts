import type { StructuredLlmProvider } from "../agent/ai-adapter.js";
import {
  OllamaStructuredLlmProvider,
  StubStructuredLlmProvider,
} from "../agent/ai-adapter.js";
import {
  getEnv,
  resolvePlanningRequirementMode,
  type Env,
} from "../../config/env.js";
import { DeterministicRequirementExtractor } from "./deterministic-extractor.js";
import { LlmRequirementExtractor } from "./llm-extractor.js";
import type { RequirementExtractor } from "./extractor.js";

export function createRequirementExtractor(
  env: Env = getEnv(),
  llm?: StructuredLlmProvider,
): RequirementExtractor {
  const mode = resolvePlanningRequirementMode(env);
  if (mode === "deterministic") {
    return new DeterministicRequirementExtractor();
  }

  const provider =
    llm ??
    (env.NODE_ENV === "test"
      ? new StubStructuredLlmProvider()
      : new OllamaStructuredLlmProvider());

  return new LlmRequirementExtractor(provider);
}
