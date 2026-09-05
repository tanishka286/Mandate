import { AppError } from "../../shared/errors/index.js";
import { ErrorCodes } from "../../shared/constants/index.js";
import { parseOrThrow } from "../../shared/validation/index.js";
import {
  assessCandidateQualityInputSchema,
  type AssessCandidateQualityInput,
  type CandidateQualityAssessment,
} from "./assessment-schema.js";
import { serializeEvidenceSummaryAsData } from "./evidence-trust-boundary.js";
import {
  assessFromCurrentEvidence,
  selectEvidenceForCandidate,
} from "./quality-assessor.js";
import { ResearchRepository } from "./repository.js";
import { AuditService } from "../audit/service.js";
import type { WorkflowAuditContext } from "../audit/types.js";
import {
  evidenceIdSchema,
  isCurrentEvidence,
  productEvidenceListSchema,
  productIdSchema,
  qualityEvidenceSchema,
  type ProductEvidenceList,
  type QualityEvidence,
} from "./schema.js";
import type { QualityEvidenceRow } from "./types.js";

/**
 * Research / quality evidence + assessment service — Phase 4.
 * Retrieval and deterministic candidate quality assessment.
 * No mutation, no optimization, no fabrication, no AI/LLM calls.
 * Expired evidence is excluded from research/assessment use.
 */
export class ResearchService {
  constructor(
    private readonly repository = new ResearchRepository(),
    private readonly auditService = new AuditService(),
  ) {}

  async getEvidenceById(evidenceId: string): Promise<QualityEvidence> {
    parseOrThrow(evidenceIdSchema, evidenceId);

    const row = await this.repository.findById(evidenceId);
    if (!row) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Quality evidence not found",
        statusCode: 404,
        details: { evidence_id: evidenceId },
      });
    }

    return this.toQualityEvidence(row);
  }

  /**
   * List current (non-expired) evidence for a product (Doc 08 §9.3).
   * Unknown product → 404. Valid product with no current evidence → empty array.
   */
  async getProductEvidence(
    productId: string,
    now: Date = new Date(),
  ): Promise<ProductEvidenceList> {
    parseOrThrow(productIdSchema, productId);

    const exists = await this.repository.productExists(productId);
    if (!exists) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Product not found",
        statusCode: 404,
        details: { product_id: productId },
      });
    }

    const current = await this.listCurrentEvidenceByProductId(productId, now);

    return parseOrThrow(productEvidenceListSchema, {
      evidence: current.map((item) => ({
        evidence_id: item.evidence_id,
        source_type: item.source_type,
        summary: serializeEvidenceSummaryAsData(item.summary),
        quality_signal: item.quality_signal,
        confidence: item.confidence,
      })),
    });
  }

  /**
   * Domain list including expired rows (tests / internal inspection).
   * Not used by the public retrieval API.
   */
  async listEvidenceByProductId(
    productId: string,
  ): Promise<QualityEvidence[]> {
    parseOrThrow(productIdSchema, productId);

    const rows = await this.repository.listByProductId(productId);
    return rows
      .map((row) => this.toQualityEvidence(row))
      .sort((a, b) => this.compareEvidenceOrder(a, b));
  }

  /**
   * Validate a domain evidence object (application-layer gate).
   * Used by later seed/backend paths — not an AI write tool.
   */
  validateEvidence(input: unknown): QualityEvidence {
    return parseOrThrow(qualityEvidenceSchema, input);
  }

  /**
   * Deterministic candidate quality assessment (Phase 4 Step 3 / FR-04).
   * Loads current evidence for the product, scopes by optional sku_id,
   * and produces an evidence-backed interpretation — not catalog authority.
   * Does not mutate evidence, catalog, stock, price, mandate, or policy.
   */
  async assessCandidateQuality(
    rawInput: AssessCandidateQualityInput,
    now: Date = new Date(),
    auditContext?: WorkflowAuditContext,
  ): Promise<CandidateQualityAssessment> {
    const input = parseOrThrow(assessCandidateQualityInputSchema, rawInput);

    const exists = await this.repository.productExists(input.product_id);
    if (!exists) {
      throw new AppError({
        code: ErrorCodes.NOT_FOUND,
        message: "Product not found",
        statusCode: 404,
        details: { product_id: input.product_id },
      });
    }

    const current = await this.listCurrentEvidenceByProductId(
      input.product_id,
      now,
    );
    const scoped = selectEvidenceForCandidate(
      input.product_id,
      input.sku_id,
      current,
    );

    const assessment = assessFromCurrentEvidence(input, scoped);

    if (auditContext) {
      await this.auditService.recordProductResearched(auditContext, {
        product_id: input.product_id,
        sku_id: input.sku_id ?? null,
        evidence_ids: scoped.map((e) => e.evidence_id),
        quality_signal: assessment.quality_signal,
        confidence: assessment.confidence,
        source_type: scoped[0]?.source_type ?? null,
      });
    }

    return assessment;
  }

  /** Current (non-expired) full evidence rows for a product. */
  async listCurrentEvidenceByProductId(
    productId: string,
    now: Date = new Date(),
  ): Promise<QualityEvidence[]> {
    parseOrThrow(productIdSchema, productId);

    const rows = await this.repository.listByProductId(productId);
    return rows
      .map((row) => this.toQualityEvidence(row))
      .filter((evidence) => isCurrentEvidence(evidence.expires_at, now))
      .sort((a, b) => this.compareEvidenceOrder(a, b));
  }

  private compareEvidenceOrder(
    a: QualityEvidence,
    b: QualityEvidence,
  ): number {
    const capturedDiff =
      Date.parse(b.captured_at) - Date.parse(a.captured_at);
    if (capturedDiff !== 0) {
      return capturedDiff;
    }
    return a.evidence_id.localeCompare(b.evidence_id);
  }

  private toQualityEvidence(row: QualityEvidenceRow): QualityEvidence {
    const confidence =
      typeof row.confidence === "string"
        ? Number(row.confidence)
        : row.confidence;

    return parseOrThrow(qualityEvidenceSchema, {
      evidence_id: row.evidence_id,
      product_id: row.product_id,
      sku_id: row.sku_id,
      source_type: row.source_type,
      source_reference: row.source_reference,
      summary: row.summary,
      quality_signal: row.quality_signal,
      confidence,
      captured_at: row.captured_at,
      expires_at: row.expires_at,
      created_at: row.created_at,
    });
  }
}
