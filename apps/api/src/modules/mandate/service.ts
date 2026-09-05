import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { MandateRepository } from "./repository.js";
import {
  mandateIdSchema,
  mandateWithCategoriesSchema,
  userIdSchema,
  type MandateWithCategories,
} from "./schema.js";
import type { MandateCategoryRow, MandateRow } from "./types.js";

/**
 * Mandate service — Phase 2 Step 2.
 * Ownership from authenticated user_id only (never client-supplied as proof).
 * Read + validation for the future policy engine. No mandate mutation API.
 */
export class MandateService {
  constructor(private readonly repository = new MandateRepository()) {}

  /**
   * Load a mandate for the authenticated user, including allow-list categories.
   * Does not require ACTIVE — use requireValidMandateForAuthorization for that.
   */
  async getMandateForUser(
    userId: string,
    mandateId: string,
  ): Promise<MandateWithCategories> {
    parseOrThrow(userIdSchema, userId);
    parseOrThrow(mandateIdSchema, mandateId);

    const row = await this.requireOwnedMandate(userId, mandateId);
    const categories = await this.repository.listCategoriesByMandateId(
      row.mandate_id,
    );
    return this.toMandateWithCategories(row, categories);
  }

  /**
   * Re-read and validate mandate for authorization (Doc 06).
   * Requires ownership, status ACTIVE, and now < valid_until.
   */
  async requireValidMandateForAuthorization(
    userId: string,
    mandateId: string,
    now: Date = new Date(),
  ): Promise<MandateWithCategories> {
    const mandate = await this.getMandateForUser(userId, mandateId);
    this.assertValidForAuthorization(mandate, now);
    return mandate;
  }

  private async requireOwnedMandate(
    userId: string,
    mandateId: string,
  ): Promise<MandateRow> {
    const existing = await this.repository.findById(mandateId);
    if (!existing) {
      throw new AppError({
        code: ErrorCodes.MANDATE_NOT_FOUND,
        message: "Mandate not found",
        statusCode: 404,
        details: { mandate_id: mandateId },
      });
    }

    if (existing.user_id !== userId) {
      throw new AppError({
        code: ErrorCodes.MANDATE_UNAUTHORIZED,
        message: "Mandate does not belong to the authenticated user",
        statusCode: 403,
        details: { mandate_id: mandateId },
      });
    }

    // Re-read with ownership filter so id alone cannot load another user's row.
    const owned = await this.repository.findByIdForUser(mandateId, userId);
    if (!owned) {
      throw new AppError({
        code: ErrorCodes.MANDATE_UNAUTHORIZED,
        message: "Mandate does not belong to the authenticated user",
        statusCode: 403,
        details: { mandate_id: mandateId },
      });
    }

    return owned;
  }

  private assertValidForAuthorization(
    mandate: MandateWithCategories,
    now: Date,
  ): void {
    if (mandate.status !== "ACTIVE") {
      throw new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "Mandate is not active for authorization",
        statusCode: 422,
        details: {
          mandate_id: mandate.mandate_id,
          status: mandate.status,
        },
      });
    }

    const validUntilMs = Date.parse(mandate.valid_until);
    if (!(now.getTime() < validUntilMs)) {
      throw new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "Mandate has expired",
        statusCode: 422,
        details: {
          mandate_id: mandate.mandate_id,
          valid_until: mandate.valid_until,
        },
      });
    }

    if (mandate.currency !== "INR") {
      throw new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "Mandate currency is not supported",
        statusCode: 422,
        details: {
          mandate_id: mandate.mandate_id,
          currency: mandate.currency,
        },
      });
    }

    if (
      !Number.isInteger(mandate.max_spend_minor) ||
      mandate.max_spend_minor < 0
    ) {
      throw new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "Mandate max_spend_minor is invalid",
        statusCode: 422,
        details: { mandate_id: mandate.mandate_id },
      });
    }

    if (
      mandate.max_per_item_minor !== null &&
      (!Number.isInteger(mandate.max_per_item_minor) ||
        mandate.max_per_item_minor < 0)
    ) {
      throw new AppError({
        code: ErrorCodes.MANDATE_INVALID,
        message: "Mandate max_per_item_minor is invalid",
        statusCode: 422,
        details: { mandate_id: mandate.mandate_id },
      });
    }
  }

  private toMandateWithCategories(
    row: MandateRow,
    categories: MandateCategoryRow[],
  ): MandateWithCategories {
    const maxPerItem =
      row.max_per_item_minor === null || row.max_per_item_minor === undefined
        ? null
        : Number(row.max_per_item_minor);

    return parseOrThrow(mandateWithCategoriesSchema, {
      mandate_id: row.mandate_id,
      user_id: row.user_id,
      agent_id: row.agent_id,
      max_spend_minor: Number(row.max_spend_minor),
      currency: row.currency,
      max_per_item_minor: maxPerItem,
      purpose: row.purpose,
      valid_until: row.valid_until,
      status: row.status,
      allowed_categories: categories.map((c) => c.category),
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }
}
