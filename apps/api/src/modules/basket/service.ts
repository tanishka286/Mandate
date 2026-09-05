import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import { SessionsRepository } from "../sessions/repository.js";
import { userIdSchema as sessionUserIdSchema } from "../sessions/schema.js";
import {
  generateQuote,
  QUOTE_AMOUNT_KIND,
  QUOTE_CURRENCY,
  type QuoteCatalogSkuSnapshot,
  type QuoteIncentiveInput,
  type QuoteLineResult,
  type QuoteAppliedIncentive,
} from "../quote/index.js";
import { BasketRepository } from "./repository.js";
import { AuditService } from "../audit/service.js";
import {
  basketQuoteDataSchema,
  basketSelectionDataSchema,
  basketViewSchema,
  createBasketQuoteBodySchema,
  createBasketSelectionBodySchema,
  materializeOptimizationBasketsInputSchema,
  sessionBasketsDataSchema,
  sessionIdParamsSchema,
  basketIdSchema,
  type BasketQuoteData,
  type BasketSelectionData,
  type BasketView,
  type MaterializeOptimizationBasketsInput,
  type SessionBasketsData,
} from "./schema.js";
import type {
  BasketIncentiveClaimRow,
  BasketItemRow,
  BasketQuoteRow,
  BasketRow,
  BasketSelectionRow,
  CatalogSkuLoadRow,
} from "./types.js";

/**
 * Basket service — Phase 7 User Selection & Fresh Quote.
 *
 * Owns:
 * - Dual-basket materialization (from optimization outputs)
 * - USER basket selection (preference only — not authorization)
 * - Fresh authoritative quote + versioning + stale detection
 *
 * Does NOT create orders, Razorpay payments, or Policy ALLOW.
 */
export class BasketService {
  constructor(
    private readonly repository = new BasketRepository(),
    private readonly sessionsRepository = new SessionsRepository(),
    private readonly auditService = new AuditService(),
  ) {}

  /**
   * Persist BEST_VALUE / BEST_QUALITY baskets for a session from optimization
   * outputs. Supersedes prior CURRENT baskets for the session (controlled
   * re-materialization). Invoked by AgentOrchestrator after successful
   * optimization — not an HTTP create-basket endpoint and not an AI tool.
   */
  async materializeOptimizationBaskets(
    userId: string,
    rawInput: unknown,
  ): Promise<SessionBasketsData> {
    parseOrThrow(sessionUserIdSchema, userId);
    const input = parseOrThrow(
      materializeOptimizationBasketsInputSchema,
      rawInput,
    ) as MaterializeOptimizationBasketsInput;

    const session = await this.requireActiveOwnedSession(
      userId,
      input.session_id,
    );

    await this.repository.supersedeCurrentBasketsForSession(session.session_id);

    const recommendationPayload = {
      recommended_basket_type:
        input.recommendation?.recommended_basket_type ?? null,
      reason: input.recommendation?.reason ?? null,
      tradeoff_summary: input.recommendation?.tradeoff_summary ?? null,
      user_may_select_alternative: true as const,
      incentive_claims: input.incentives ?? [],
    };

    const run = await this.repository.insertOptimizationRun({
      session_id: session.session_id,
      intent_id: input.intent_id ?? null,
      mandate_id: input.mandate_id ?? null,
      status: "COMPLETED",
      candidate_count:
        (input.best_value ? 1 : 0) + (input.best_quality ? 1 : 0),
      recommendation_json: recommendationPayload,
      completed_at: new Date().toISOString(),
    });

    if (input.best_value) {
      await this.insertBasketWithItems({
        optimization_run_id: run.optimization_run_id,
        session_id: session.session_id,
        user_id: userId,
        basket: input.best_value,
      });
    }
    if (input.best_quality) {
      await this.insertBasketWithItems({
        optimization_run_id: run.optimization_run_id,
        session_id: session.session_id,
        user_id: userId,
        basket: input.best_quality,
      });
    }

    const sessionBaskets = await this.getSessionBaskets(userId, session.session_id);
    const auditContext = {
      user_id: userId,
      session_id: session.session_id,
      mandate_id: input.mandate_id ?? null,
      optimization_run_id: run.optimization_run_id,
      agent_run_id: input.agent_run_id ?? null,
      request_id: input.request_id ?? null,
    };

    for (const view of [sessionBaskets.best_value, sessionBaskets.best_quality]) {
      if (!view) continue;
      await this.auditService.recordBasketCreated(auditContext, {
        basket_id: view.basket_id,
        basket_type: view.basket_type,
        gross_amount_minor: view.gross_amount_minor,
        discount_amount_minor: view.discount_amount_minor,
        final_payable_minor: view.final_payable_minor,
      });
    }

    if (sessionBaskets.recommendation) {
      await this.auditService.recordBasketRecommended(auditContext, {
        recommended_basket_id: sessionBaskets.recommendation.recommended_basket_id,
        recommended_basket_type: sessionBaskets.recommendation.recommended_basket_type,
        reason: sessionBaskets.recommendation.reason,
        tradeoff_summary: sessionBaskets.recommendation.tradeoff_summary,
      });
    }

    return sessionBaskets;
  }

  async getSessionBaskets(
    userId: string,
    sessionId: string,
  ): Promise<SessionBasketsData> {
    parseOrThrow(sessionUserIdSchema, userId);
    parseOrThrow(sessionIdParamsSchema, { session_id: sessionId });
    await this.requireActiveOwnedSession(userId, sessionId);

    const run =
      await this.repository.findLatestOptimizationRunForSession(sessionId);
    const baskets =
      await this.repository.listCurrentBasketsForSession(sessionId);

    let best_value: BasketView | null = null;
    let best_quality: BasketView | null = null;
    for (const row of baskets) {
      const view = await this.toBasketView(row);
      if (view.basket_type === "BEST_VALUE") {
        best_value = view;
      } else if (view.basket_type === "BEST_QUALITY") {
        best_quality = view;
      }
    }

    const recJson = run?.recommendation_json;
    const recObj =
      recJson && typeof recJson === "object"
        ? (recJson as Record<string, unknown>)
        : null;

    const recommendedType =
      typeof recObj?.recommended_basket_type === "string"
        ? (recObj.recommended_basket_type as "BEST_VALUE" | "BEST_QUALITY")
        : null;

    let recommendedBasketId: string | null = null;
    if (recommendedType === "BEST_VALUE" && best_value) {
      recommendedBasketId = best_value.basket_id;
    } else if (recommendedType === "BEST_QUALITY" && best_quality) {
      recommendedBasketId = best_quality.basket_id;
    }

    const active = await this.repository.findActiveSelectionForSession(
      sessionId,
    );

    return parseOrThrow(sessionBasketsDataSchema, {
      session_id: sessionId,
      optimization_run_id: run?.optimization_run_id ?? null,
      best_value,
      best_quality,
      recommendation: run
        ? {
            recommended_basket_type: recommendedType,
            recommended_basket_id: recommendedBasketId,
            reason:
              typeof recObj?.reason === "string" ? recObj.reason : null,
            tradeoff_summary:
              typeof recObj?.tradeoff_summary === "string"
                ? recObj.tradeoff_summary
                : null,
            user_may_select_alternative: true,
          }
        : null,
      active_selection: active
        ? {
            selection_id: active.selection_id,
            session_id: active.session_id,
            basket_id: active.basket_id,
            selection_source: "USER" as const,
            status: "SELECTED" as const,
            selected_at: active.selected_at,
            superseded_at: active.superseded_at,
            created_at: active.created_at,
          }
        : null,
    });
  }

  /**
   * Record USER preference for a CURRENT basket in the session's latest
   * optimization run. Does not authorize payment or create orders.
   */
  async selectBasket(
    userId: string,
    sessionId: string,
    body: unknown,
    requestId?: string,
  ): Promise<BasketSelectionData> {
    parseOrThrow(sessionUserIdSchema, userId);
    parseOrThrow(sessionIdParamsSchema, { session_id: sessionId });
    const input = parseOrThrow(createBasketSelectionBodySchema, body);

    await this.requireActiveOwnedSession(userId, sessionId);
    const basket = await this.requireSelectableBasket(
      userId,
      sessionId,
      input.basket_id,
    );

    const now = new Date().toISOString();
    const prior = await this.repository.findActiveSelectionForSession(
      sessionId,
    );
    if (prior) {
      await this.repository.supersedeSelection(prior.selection_id, now);
    }

    const row = await this.repository.insertSelection({
      session_id: sessionId,
      basket_id: basket.basket_id,
      user_id: userId,
      selection_source: input.selection_source,
      selected_at: now,
    });

    await this.auditService.recordBasketSelected(
      {
        user_id: userId,
        session_id: sessionId,
        basket_id: basket.basket_id,
        optimization_run_id: basket.optimization_run_id,
        request_id: requestId ?? null,
      },
      {
        selection_id: row.selection_id,
        basket_id: basket.basket_id,
        selection_source: input.selection_source,
      },
    );

    return this.toSelectionData(row);
  }

  /**
   * Create a fresh authoritative quote for an owned basket.
   * Ignores client financial claims. Does not emit Policy ALLOW or payment.
   */
  async createFreshQuote(
    userId: string,
    basketId: string,
    body: unknown,
    requestId?: string,
  ): Promise<BasketQuoteData> {
    parseOrThrow(sessionUserIdSchema, userId);
    parseOrThrow(basketIdSchema, basketId);
    // Validate shape; client_claims intentionally unused below.
    const parsedBody = parseOrThrow(createBasketQuoteBodySchema, body ?? {});
    void parsedBody.client_claims;

    const basket = await this.requireOwnedCurrentBasket(userId, basketId);
    await this.requireActiveOwnedSession(userId, basket.session_id);

    const items = await this.repository.listBasketItems(basket.basket_id);
    if (items.length === 0) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Basket has no items to quote",
        statusCode: 400,
        details: { basket_id: basket.basket_id },
      });
    }

    const skuIds = items.map((item) => item.sku_id);
    const catalogRows = await this.repository.loadCatalogSnapshots(skuIds);
    const catalog: QuoteCatalogSkuSnapshot[] = catalogRows.map((row) =>
      this.toCatalogSnapshot(row),
    );

    const run = await this.repository.findOptimizationRunById(
      basket.optimization_run_id,
    );
    const claims = this.repository.extractIncentiveClaims(
      run?.recommendation_json,
    );
    const incentives = this.resolveCurrentIncentives(claims);

    const result = generateQuote({
      basket_id: basket.basket_id,
      currency: QUOTE_CURRENCY,
      items: items.map((item) => ({
        sku_id: item.sku_id,
        quantity: item.quantity,
        snapshot_unit_price_minor: Number(item.unit_price_minor),
      })),
      catalog,
      incentives,
      client_claims: parsedBody.client_claims,
    });

    if (!result.ok) {
      throw this.mapQuoteFailure(result.reason_code, result.message, basket.basket_id);
    }

    const catalog_fingerprint = deriveCatalogFingerprint(catalogRows);
    const incentive_fingerprint = deriveIncentiveFingerprint(incentives);

    await this.repository.markQuotesStaleOrSuperseded(
      basket.basket_id,
      "SUPERSEDED",
    );

    const activeSelection =
      await this.repository.findActiveSelectionForSession(basket.session_id);
    const selectionId =
      activeSelection && activeSelection.basket_id === basket.basket_id
        ? activeSelection.selection_id
        : null;

    const quotePayload = {
      basket_id: basket.basket_id,
      session_id: basket.session_id,
      user_id: userId,
      selection_id: selectionId,
      optimization_run_id: basket.optimization_run_id,
      quote_version: result.quote_version,
      basket_state_version: basket.state_version,
      gross_amount_minor: result.gross_amount_minor,
      discount_amount_minor: result.discount_amount_minor,
      final_payable_minor: result.final_payable_minor,
      lines_json: result.lines,
      applied_incentives_json: result.applied_incentives,
      catalog_fingerprint,
      incentive_fingerprint,
      status: "CURRENT" as const,
      request_id: requestId ?? null,
    };

    const reactivated = await this.repository.reactivateSupersededQuote({
      basket_id: basket.basket_id,
      quote_version: result.quote_version,
      selection_id: selectionId,
      gross_amount_minor: result.gross_amount_minor,
      discount_amount_minor: result.discount_amount_minor,
      final_payable_minor: result.final_payable_minor,
      lines_json: result.lines,
      applied_incentives_json: result.applied_incentives,
      catalog_fingerprint,
      incentive_fingerprint,
      basket_state_version: basket.state_version,
      request_id: requestId ?? null,
    });

    const quoteRow =
      reactivated ??
      (await this.repository.insertQuote(quotePayload));

    await this.auditService.recordFreshQuote(
      {
        user_id: userId,
        session_id: basket.session_id,
        basket_id: basket.basket_id,
        optimization_run_id: basket.optimization_run_id,
        request_id: requestId ?? null,
      },
      {
        basket_id: basket.basket_id,
        quote_version: result.quote_version,
        gross_amount_minor: result.gross_amount_minor,
        discount_amount_minor: result.discount_amount_minor,
        final_payable_minor: result.final_payable_minor,
        basket_state_version: basket.state_version,
        selection_id: selectionId,
      },
    );

    return this.toQuoteData(quoteRow, result.lines, result.applied_incentives);
  }

  /**
   * Resolve a persisted quote for policy evaluation.
   * Throws QUOTE_STALE when the quote no longer matches current basket/catalog
   * /incentive state. Returns null when no trusted quote exists.
   */
  async resolveQuoteForPolicy(input: {
    user_id: string;
    basket_id: string;
    quote_version: string;
  }): Promise<{
    lines: Array<{ sku_id: string; quantity: number }>;
    claimed_incentive_ids: string[];
  } | null> {
    parseOrThrow(sessionUserIdSchema, input.user_id);
    parseOrThrow(basketIdSchema, input.basket_id);

    const basket = await this.repository.findBasketById(input.basket_id);
    if (!basket) {
      return null;
    }
    if (basket.user_id !== input.user_id) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Basket does not belong to the authenticated user",
        statusCode: 403,
        details: { basket_id: input.basket_id },
      });
    }

    const quote = await this.repository.findQuoteByBasketAndVersion(
      input.basket_id,
      input.quote_version,
    );
    if (!quote) {
      return null;
    }
    if (quote.user_id !== input.user_id) {
      return null;
    }

    await this.assertQuoteNotStale(basket, quote);

    const lines = this.parseQuoteLines(quote.lines_json);
    const incentives = this.parseAppliedIncentives(
      quote.applied_incentives_json,
    );

    return {
      lines: lines.map((line) => ({
        sku_id: line.sku_id,
        quantity: line.quantity,
      })),
      claimed_incentive_ids: incentives.map((i) => i.incentive_id),
    };
  }

  /**
   * Test/helper: mutate a basket line and bump state_version so prior quotes
   * become stale. Does not recalculate planning snapshots.
   */
  async mutateBasketItemQuantity(
    userId: string,
    basketId: string,
    skuId: string,
    quantity: number,
  ): Promise<BasketView> {
    parseOrThrow(sessionUserIdSchema, userId);
    const basket = await this.requireOwnedCurrentBasket(userId, basketId);
    await this.repository.replaceBasketItemQuantity({
      basket_id: basket.basket_id,
      sku_id: skuId,
      quantity,
      next_state_version: basket.state_version + 1,
    });
    await this.repository.markQuotesStaleOrSuperseded(
      basket.basket_id,
      "STALE",
    );
    const updated = await this.repository.findBasketById(basket.basket_id);
    if (!updated) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Basket not found after mutation",
        statusCode: 404,
        details: { basket_id: basketId },
      });
    }
    return this.toBasketView(updated);
  }

  private async assertQuoteNotStale(
    basket: BasketRow,
    quote: BasketQuoteRow,
  ): Promise<void> {
    if (quote.status === "STALE" || quote.status === "SUPERSEDED") {
      throw this.quoteStaleError(basket.basket_id);
    }

    if (quote.basket_state_version !== basket.state_version) {
      throw this.quoteStaleError(basket.basket_id);
    }

    const items = await this.repository.listBasketItems(basket.basket_id);
    const catalogRows = await this.repository.loadCatalogSnapshots(
      items.map((i) => i.sku_id),
    );
    const catalogFp = deriveCatalogFingerprint(catalogRows);
    if (catalogFp !== quote.catalog_fingerprint) {
      throw this.quoteStaleError(basket.basket_id);
    }

    const run = await this.repository.findOptimizationRunById(
      basket.optimization_run_id,
    );
    const claims = this.repository.extractIncentiveClaims(
      run?.recommendation_json,
    );
    const incentives = this.resolveCurrentIncentives(claims);
    const incentiveFp = deriveIncentiveFingerprint(incentives);
    if (incentiveFp !== quote.incentive_fingerprint) {
      throw this.quoteStaleError(basket.basket_id);
    }
  }

  private quoteStaleError(basketId: string): AppError {
    return new AppError({
      code: ErrorCodes.QUOTE_STALE,
      message: "Basket pricing changed; a fresh quote is required.",
      statusCode: 409,
      details: { basket_id: basketId },
    });
  }

  private mapQuoteFailure(
    reason: string,
    message: string,
    basketId: string,
  ): AppError {
    if (reason === "STOCK_UNAVAILABLE") {
      return new AppError({
        code: ErrorCodes.STOCK_UNAVAILABLE,
        message,
        statusCode: 409,
        details: { basket_id: basketId },
      });
    }
    if (reason === "INVALID_QUOTE_STATE") {
      return new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message,
        statusCode: 400,
        details: { basket_id: basketId, reason_code: reason },
      });
    }
    return new AppError({
      code: reason,
      message,
      statusCode: reason === "VALIDATION_ERROR" ? 400 : 422,
      details: { basket_id: basketId },
    });
  }

  private resolveCurrentIncentives(
    claims: BasketIncentiveClaimRow[],
  ): QuoteIncentiveInput[] {
    const now = Date.now();
    return claims.map((claim) => {
      let validity = claim.validity;
      if (
        claim.valid_until &&
        !Number.isNaN(Date.parse(claim.valid_until)) &&
        Date.parse(claim.valid_until) < now
      ) {
        validity = "EXPIRED";
      }
      return {
        incentive_id: claim.incentive_id,
        kind: claim.kind,
        decision: claim.decision,
        validity,
        eligibility: claim.eligibility,
        benefit_minor: claim.benefit_minor,
        benefit_identity: claim.benefit_identity,
      };
    });
  }

  private async insertBasketWithItems(args: {
    optimization_run_id: string;
    session_id: string;
    user_id: string;
    basket: NonNullable<MaterializeOptimizationBasketsInput["best_value"]>;
  }): Promise<BasketRow> {
    const spec = args.basket;
    const gross =
      spec.gross_amount_minor ??
      spec.items.reduce(
        (sum, line) =>
          sum + (line.line_amount_minor ?? (line.unit_price_minor ?? 0) * line.quantity),
        0,
      );
    const discount = spec.discount_amount_minor ?? 0;
    const finalPayable = spec.final_payable_minor ?? Math.max(0, gross - discount);

    const basket = await this.repository.insertBasket({
      optimization_run_id: args.optimization_run_id,
      session_id: args.session_id,
      user_id: args.user_id,
      basket_type: spec.basket_type,
      status: "CURRENT",
      gross_amount_minor: gross,
      discount_amount_minor: discount,
      final_payable_minor: finalPayable,
      quality_summary: spec.quality_summary ?? null,
      recommendation_reason: spec.recommendation_reason ?? null,
      explanation: spec.explanation ?? null,
      combination_key: spec.combination_key ?? null,
    });

    for (const line of spec.items) {
      const unit = line.unit_price_minor ?? 0;
      await this.repository.insertBasketItem({
        basket_id: basket.basket_id,
        requirement_id: line.requirement_id ?? null,
        sku_id: line.sku_id,
        quantity: line.quantity,
        unit_price_minor: unit,
        line_amount_minor: line.line_amount_minor ?? unit * line.quantity,
        quality_level: line.quality_level ?? null,
        evidence_refs_json: line.evidence_refs_json ?? [],
      });
    }

    return basket;
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
        details: { session_id: sessionId, status: session.status },
      });
    }
    return session;
  }

  private async requireOwnedCurrentBasket(
    userId: string,
    basketId: string,
  ): Promise<BasketRow> {
    const basket = await this.repository.findBasketById(basketId);
    if (!basket) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Basket not found",
        statusCode: 404,
        details: { basket_id: basketId },
      });
    }
    if (basket.user_id !== userId) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Basket does not belong to the authenticated user",
        statusCode: 403,
        details: { basket_id: basketId },
      });
    }
    if (basket.status !== "CURRENT") {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: "Basket is not a valid current basket",
        statusCode: 409,
        details: { basket_id: basketId, status: basket.status },
      });
    }
    return basket;
  }

  private async requireSelectableBasket(
    userId: string,
    sessionId: string,
    basketId: string,
  ): Promise<BasketRow> {
    const basket = await this.requireOwnedCurrentBasket(userId, basketId);

    if (basket.session_id !== sessionId) {
      throw new AppError({
        code: ErrorCodes.FORBIDDEN,
        message: "Basket does not belong to this shopping session",
        statusCode: 403,
        details: { basket_id: basketId, session_id: sessionId },
      });
    }

    const latest =
      await this.repository.findLatestOptimizationRunForSession(sessionId);
    if (
      !latest ||
      latest.optimization_run_id !== basket.optimization_run_id
    ) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: "Basket does not belong to the current optimization result",
        statusCode: 409,
        details: {
          basket_id: basketId,
          optimization_run_id: basket.optimization_run_id,
        },
      });
    }

    return basket;
  }

  private async toBasketView(row: BasketRow): Promise<BasketView> {
    const items = await this.repository.listBasketItems(row.basket_id);
    return parseOrThrow(basketViewSchema, {
      basket_id: row.basket_id,
      optimization_run_id: row.optimization_run_id,
      session_id: row.session_id,
      user_id: row.user_id,
      basket_type: row.basket_type,
      status: row.status,
      gross_amount_minor: Number(row.gross_amount_minor),
      discount_amount_minor: Number(row.discount_amount_minor),
      final_payable_minor: Number(row.final_payable_minor),
      currency: row.currency,
      quality_summary: row.quality_summary,
      recommendation_reason: row.recommendation_reason,
      explanation: row.explanation,
      combination_key: row.combination_key,
      state_version: row.state_version,
      items: items.map((item) => this.toItemView(item)),
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  private toItemView(item: BasketItemRow) {
    const refs = Array.isArray(item.evidence_refs_json)
      ? item.evidence_refs_json
      : [];
    return {
      basket_item_id: item.basket_item_id,
      basket_id: item.basket_id,
      requirement_id: item.requirement_id,
      sku_id: item.sku_id,
      quantity: item.quantity,
      unit_price_minor: Number(item.unit_price_minor),
      line_amount_minor: Number(item.line_amount_minor),
      quality_level: item.quality_level,
      evidence_refs_json: refs,
      created_at: item.created_at,
      updated_at: item.updated_at,
    };
  }

  private toSelectionData(row: BasketSelectionRow): BasketSelectionData {
    return parseOrThrow(basketSelectionDataSchema, {
      selection_id: row.selection_id,
      session_id: row.session_id,
      basket_id: row.basket_id,
      selection_source: "USER",
      status: "SELECTED",
      selected_at: row.selected_at,
      superseded_at: row.superseded_at,
      created_at: row.created_at,
      order_created: false,
      payment_created: false,
      policy_decision: null,
    });
  }

  private toQuoteData(
    row: BasketQuoteRow,
    lines: QuoteLineResult[],
    applied: QuoteAppliedIncentive[],
  ): BasketQuoteData {
    return parseOrThrow(basketQuoteDataSchema, {
      quote_id: row.quote_id,
      basket_id: row.basket_id,
      session_id: row.session_id,
      selection_id: row.selection_id,
      optimization_run_id: row.optimization_run_id,
      currency: QUOTE_CURRENCY,
      amount_kind: QUOTE_AMOUNT_KIND,
      gross_amount_minor: Number(row.gross_amount_minor),
      discount_amount_minor: Number(row.discount_amount_minor),
      final_payable_minor: Number(row.final_payable_minor),
      quote_version: row.quote_version,
      basket_state_version: row.basket_state_version,
      lines,
      applied_incentives: applied,
      catalog_fingerprint: row.catalog_fingerprint,
      incentive_fingerprint: row.incentive_fingerprint,
      policy_decision: null,
      payment_created: false,
      order_created: false,
    });
  }

  private toCatalogSnapshot(row: CatalogSkuLoadRow): QuoteCatalogSkuSnapshot {
    return {
      sku_id: row.sku_id,
      price_minor: row.price_minor,
      currency: row.currency,
      available_quantity: row.available_quantity,
      sku_status: row.sku_status,
      product_status: row.product_status,
    };
  }

  private parseQuoteLines(raw: unknown): QuoteLineResult[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw as QuoteLineResult[];
  }

  private parseAppliedIncentives(raw: unknown): QuoteAppliedIncentive[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw as QuoteAppliedIncentive[];
  }
}

export function deriveCatalogFingerprint(
  rows: readonly CatalogSkuLoadRow[],
): string {
  const part = [...rows]
    .map(
      (row) =>
        `${row.sku_id}:${row.price_minor}:${row.available_quantity ?? "null"}:${row.sku_status}:${row.product_status}`,
    )
    .sort((a, b) => a.localeCompare(b))
    .join("|");
  return createHash("sha256").update(part, "utf8").digest("hex").slice(0, 24);
}

export function deriveIncentiveFingerprint(
  incentives: readonly QuoteIncentiveInput[],
): string {
  const part = [...incentives]
    .map(
      (i) =>
        `${i.incentive_id}:${i.kind}:${i.decision}:${i.validity}:${i.eligibility}:${i.benefit_minor}`,
    )
    .sort((a, b) => a.localeCompare(b))
    .join("|");
  return createHash("sha256").update(part, "utf8").digest("hex").slice(0, 24);
}
