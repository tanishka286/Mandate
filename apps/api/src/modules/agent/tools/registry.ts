import {
  AGENT_TOOL_NAMES,
  FORBIDDEN_AGENT_TOOL_NAMES,
  type AgentToolName,
  type ToolResult,
} from "../schema.js";
import type { StructuredLlmProvider } from "../ai-adapter.js";
import type { RequirementExtractor } from "../../requirements/extractor.js";
import type { CatalogService } from "../../catalog/service.js";
import type { ResearchService } from "../../research/service.js";
import type { PolicyService } from "../../policy/service.js";

/**
 * Explicit allowlisted tool registry (Phase 6).
 *
 * Only tools listed in AGENT_TOOL_NAMES may be registered or invoked.
 * Forbidden capabilities (DB/SQL/ORM/mandate mutation/payment/etc.) are
 * never registered and cannot be added dynamically by LLM output.
 */

export type AgentToolContext = {
  extractor: RequirementExtractor;
  catalog: CatalogService;
  research: ResearchService;
  policy: PolicyService;
  llm?: StructuredLlmProvider;
};

export type AgentToolHandler = (
  args: Record<string, unknown>,
  context: AgentToolContext,
) => Promise<ToolResult>;

export class AgentToolRegistry {
  private readonly handlers = new Map<AgentToolName, AgentToolHandler>();

  register(name: AgentToolName, handler: AgentToolHandler): void {
    if (!(AGENT_TOOL_NAMES as readonly string[]).includes(name)) {
      throw new Error(`Refusing to register non-allowlisted tool: ${name}`);
    }
    if ((FORBIDDEN_AGENT_TOOL_NAMES as readonly string[]).includes(name)) {
      throw new Error(`Refusing to register forbidden tool: ${name}`);
    }
    this.handlers.set(name, handler);
  }

  has(name: string): boolean {
    return this.handlers.has(name as AgentToolName);
  }

  list(): readonly AgentToolName[] {
    return AGENT_TOOL_NAMES.filter((name) => this.handlers.has(name));
  }

  /** Hard allowlist — rejects unknown and forbidden names before dispatch. */
  async invoke(
    name: string,
    args: Record<string, unknown>,
    context: AgentToolContext,
  ): Promise<ToolResult> {
    if ((FORBIDDEN_AGENT_TOOL_NAMES as readonly string[]).includes(name)) {
      return {
        tool: "extract_requirements",
        status: "ERROR",
        error: {
          code: "TOOL_FORBIDDEN",
          message: `Tool "${name}" is forbidden and cannot be invoked by the agent.`,
        },
      };
    }

    if (!(AGENT_TOOL_NAMES as readonly string[]).includes(name)) {
      return {
        tool: "extract_requirements",
        status: "ERROR",
        error: {
          code: "TOOL_NOT_ALLOWLISTED",
          message: `Tool "${name}" is not in the agent allowlist.`,
        },
      };
    }

    const toolName = name as AgentToolName;
    const handler = this.handlers.get(toolName);
    if (!handler) {
      return {
        tool: toolName,
        status: "ERROR",
        error: {
          code: "TOOL_NOT_REGISTERED",
          message: `Allowlisted tool "${toolName}" is not registered.`,
        },
      };
    }

    return handler(args, context);
  }
}

export function assertAllowlistedOnly(
  registered: readonly string[],
): void {
  for (const name of registered) {
    if (!(AGENT_TOOL_NAMES as readonly string[]).includes(name)) {
      throw new Error(`Non-allowlisted tool registered: ${name}`);
    }
    if ((FORBIDDEN_AGENT_TOOL_NAMES as readonly string[]).includes(name)) {
      throw new Error(`Forbidden tool registered: ${name}`);
    }
  }
}
