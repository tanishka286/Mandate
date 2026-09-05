import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { MandateService } from "../mandate/service.js";
import { SessionsRepository } from "../sessions/repository.js";
import { userIdSchema as sessionUserIdSchema } from "../sessions/schema.js";
import { IntentsRepository } from "./repository.js";
import {
  createShoppingIntentBodySchema,
  createShoppingIntentDataSchema,
  sessionIdSchema,
  shoppingIntentSchema,
  type CreateShoppingIntentBody,
  type CreateShoppingIntentData,
  type ShoppingIntent,
} from "./schema.js";
import type { ShoppingIntentRow } from "./types.js";

/**
 * Shopping intent service — Phase 3 Step 4.
 * Creates a CREATED intent for an ACTIVE owned session + owned ACTIVE mandate.
 * Does not extract requirements, search catalog, or mutate mandates.
 */
export class IntentsService {
  constructor(
    private readonly intentsRepository = new IntentsRepository(),
    private readonly sessionsRepository = new SessionsRepository(),
    private readonly mandateService = new MandateService(),
  ) {}

  async createIntent(
    userId: string,
    sessionId: string,
    body: unknown,
  ): Promise<CreateShoppingIntentData> {
    parseOrThrow(sessionUserIdSchema, userId);
    parseOrThrow(sessionIdSchema, sessionId);
    const input = parseOrThrow(createShoppingIntentBodySchema, body);

    const session = await this.requireActiveOwnedSession(userId, sessionId);

    // Mandate remains the authorization ceiling; budget_minor is planning input only.
    const mandate = await this.mandateService.requireValidMandateForAuthorization(
      userId,
      input.mandate_id,
    );

    const row = await this.intentsRepository.insert({
      session_id: session.session_id,
      mandate_id: mandate.mandate_id,
      goal_text: input.goal_text,
      category: input.category,
      budget_minor: input.budget_minor ?? null,
      quality_preference: input.quality_preference ?? null,
      status: "CREATED",
      // Request constraints are not assumptions_json (no locked mapping on intent).
      assumptions_json: [],
    });

    const persisted = this.toShoppingIntent(row);
    return parseOrThrow(createShoppingIntentDataSchema, {
      intent_id: persisted.intent_id,
      session_id: persisted.session_id,
      mandate_id: persisted.mandate_id,
      status: "CREATED",
    });
  }

  /**
   * Load a persisted intent by id (tests / later steps).
   * Does not perform ownership checks — caller must scope via session.
   */
  async getIntentById(intentId: string): Promise<ShoppingIntent | null> {
    const row = await this.intentsRepository.findById(intentId);
    if (!row) {
      return null;
    }
    return this.toShoppingIntent(row);
  }

  /** Expose normalized create input for unit tests that assert preservation. */
  normalizeCreateBody(body: unknown): CreateShoppingIntentBody {
    return parseOrThrow(createShoppingIntentBodySchema, body);
  }

  private async requireActiveOwnedSession(
    userId: string,
    sessionId: string,
  ): Promise<{ session_id: string; user_id: string; status: string }> {
    const session = await this.sessionsRepository.findById(sessionId);
    if (!session) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Shopping session not found",
        statusCode: 404,
        details: { session_id: sessionId },
      });
    }

    if (session.user_id !== userId) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Shopping session does not belong to the authenticated user",
        statusCode: 403,
        details: { session_id: sessionId },
      });
    }

    if (session.status !== "ACTIVE") {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: "Shopping session is not ACTIVE",
        statusCode: 409,
        details: {
          session_id: sessionId,
          status: session.status,
        },
      });
    }

    return session;
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
}
