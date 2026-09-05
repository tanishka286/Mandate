import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { z } from "zod";
import { IntentsRepository } from "../intents/repository.js";
import {
  shoppingIntentSchema,
  type ShoppingIntent,
} from "../intents/schema.js";
import type { ShoppingIntentRow } from "../intents/types.js";
import { SessionsRepository } from "../sessions/repository.js";
import { DeterministicRequirementExtractor } from "./deterministic-extractor.js";
import type { RequirementExtractor } from "./extractor.js";
import {
  extractedRequirementDraftSchema,
  extractionAssumptionSchema,
  requirementExtractionResponseDataSchema,
  type ExtractionAssumption,
  type RequirementExtractionItem,
  type RequirementExtractionResponseData,
} from "./extraction-schema.js";
import { RequirementsRepository } from "./repository.js";
import {
  intentIdSchema,
  requirementSchema,
  type Requirement,
} from "./schema.js";
import type { RequirementRow } from "./types.js";

const userIdSchema = z.string().uuid();

const EXTRACTABLE_INTENT_STATUSES = new Set(["CREATED", "PLANNING"]);

/**
 * Requirement extraction service — Phase 3 Steps 5–6.
 * Owns ownership/state gates, persistence, and extractor orchestration.
 * Does not call LLMs; uses RequirementExtractor port (deterministic for now).
 *
 * Persistence invariant: validate ALL drafts → insertMany → update intent.
 * Clarification returns HTTP 200 with CLARIFICATION_REQUIRED (not 500).
 */
export class RequirementsService {
  constructor(
    private readonly requirementsRepository = new RequirementsRepository(),
    private readonly intentsRepository = new IntentsRepository(),
    private readonly sessionsRepository = new SessionsRepository(),
    private readonly extractor: RequirementExtractor = new DeterministicRequirementExtractor(),
  ) {}

  async extractRequirements(
    userId: string,
    intentId: string,
  ): Promise<RequirementExtractionResponseData> {
    parseOrThrow(userIdSchema, userId);
    parseOrThrow(intentIdSchema, intentId);

    const intent = await this.requireOwnedExtractableIntent(userId, intentId);

    const existing = await this.requirementsRepository.listByIntentId(
      intent.intent_id,
    );
    if (existing.length > 0) {
      return this.toSuccessResponse(
        intent.intent_id,
        existing.map((row) => this.toRequirement(row)),
        this.readAssumptions(intent.assumptions_json),
      );
    }

    const extraction = this.extractor.extract(intent);

    if (extraction.status === "CLARIFICATION_REQUIRED") {
      return parseOrThrow(requirementExtractionResponseDataSchema, {
        status: "CLARIFICATION_REQUIRED",
        intent_id: intent.intent_id,
        requirements: [],
        assumptions: extraction.assumptions,
        clarification: extraction.clarification,
      });
    }

    // Validate every draft before any write — fail closed, no partial persist.
    const validatedDrafts = extraction.requirements.map((draft) =>
      parseOrThrow(extractedRequirementDraftSchema, draft),
    );

    const inserted = await this.requirementsRepository.insertMany(
      validatedDrafts.map((draft) => ({
        intent_id: intent.intent_id,
        item_name: draft.item_name,
        target_quantity: draft.target_quantity,
        unit: draft.unit,
        minimum_quality: draft.minimum_quality,
        constraints_json: draft.constraints_json,
        confidence: draft.confidence,
        status: "CREATED",
      })),
    );

    if (inserted.length !== validatedDrafts.length) {
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "Failed to persist all extracted requirements",
        statusCode: 500,
        expose: false,
      });
    }

    // CREATED → PLANNING once requirements are available (Doc 08 extract gate).
    await this.intentsRepository.updateExtractionState(intent.intent_id, {
      status: "PLANNING",
      assumptions_json: extraction.assumptions,
    });

    return this.toSuccessResponse(
      intent.intent_id,
      inserted.map((row) => this.toRequirement(row)),
      extraction.assumptions,
    );
  }

  private async requireOwnedExtractableIntent(
    userId: string,
    intentId: string,
  ): Promise<ShoppingIntent> {
    const row = await this.intentsRepository.findById(intentId);
    if (!row) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Shopping intent not found",
        statusCode: 404,
        details: { intent_id: intentId },
      });
    }

    const session = await this.sessionsRepository.findById(row.session_id);
    if (!session) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Shopping session not found for intent",
        statusCode: 404,
        details: { intent_id: intentId, session_id: row.session_id },
      });
    }

    if (session.user_id !== userId) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Shopping intent does not belong to the authenticated user",
        statusCode: 403,
        details: { intent_id: intentId },
      });
    }

    // Gate on raw status before schema parse so non-extractable rows fail closed.
    if (!EXTRACTABLE_INTENT_STATUSES.has(row.status)) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: "Shopping intent is not in an extractable state",
        statusCode: 409,
        details: {
          intent_id: intentId,
          status: row.status,
        },
      });
    }

    return this.toShoppingIntent(row);
  }

  private toSuccessResponse(
    intentId: string,
    requirements: Requirement[],
    assumptions: ExtractionAssumption[],
  ): RequirementExtractionResponseData {
    const items: RequirementExtractionItem[] = requirements.map((req) => ({
      requirement_id: req.requirement_id,
      item_name: req.item_name,
      target_quantity: req.target_quantity,
      unit: req.unit,
      minimum_quality: req.minimum_quality,
      confidence: req.confidence,
    }));

    return parseOrThrow(requirementExtractionResponseDataSchema, {
      status: "SUCCESS",
      intent_id: intentId,
      requirements: items,
      assumptions,
    });
  }

  private readAssumptions(value: unknown): ExtractionAssumption[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const assumptions: ExtractionAssumption[] = [];
    for (const entry of value) {
      const parsed = extractionAssumptionSchema.safeParse(entry);
      if (parsed.success) {
        assumptions.push(parsed.data);
      }
    }
    return assumptions;
  }

  private toShoppingIntent(row: ShoppingIntentRow): ShoppingIntent {
    const budget =
      row.budget_minor === null || row.budget_minor === undefined
        ? null
        : typeof row.budget_minor === "string"
          ? Number(row.budget_minor)
          : row.budget_minor;

    return parseOrThrow(shoppingIntentSchema, {
      intent_id: row.intent_id,
      session_id: row.session_id,
      mandate_id: row.mandate_id,
      goal_text: row.goal_text,
      category: row.category,
      budget_minor: budget,
      quality_preference: row.quality_preference,
      status: row.status,
      assumptions_json: Array.isArray(row.assumptions_json)
        ? row.assumptions_json
        : [],
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  private toRequirement(row: RequirementRow): Requirement {
    const quantity =
      typeof row.target_quantity === "string"
        ? Number(row.target_quantity)
        : row.target_quantity;
    const confidence =
      row.confidence === null || row.confidence === undefined
        ? null
        : typeof row.confidence === "string"
          ? Number(row.confidence)
          : row.confidence;

    return parseOrThrow(requirementSchema, {
      requirement_id: row.requirement_id,
      intent_id: row.intent_id,
      item_name: row.item_name,
      target_quantity: quantity,
      unit: row.unit,
      minimum_quality: row.minimum_quality,
      constraints_json: Array.isArray(row.constraints_json)
        ? row.constraints_json
        : [],
      confidence,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }
}
