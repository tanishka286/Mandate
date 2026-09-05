import { describe, it, expect } from "vitest";
import { RequirementsService } from "../../src/modules/requirements/service.js";
import type { RequirementsRepository } from "../../src/modules/requirements/repository.js";
import type { IntentsRepository } from "../../src/modules/intents/repository.js";
import type { SessionsRepository } from "../../src/modules/sessions/repository.js";
import type { RequirementExtractor } from "../../src/modules/requirements/extractor.js";
import type { ShoppingIntentRow } from "../../src/modules/intents/types.js";
import type { ShoppingSessionRow } from "../../src/modules/sessions/types.js";
import type { RequirementRow } from "../../src/modules/requirements/types.js";
import type { ExtractionResult } from "../../src/modules/requirements/extraction-schema.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { AppError } from "../../src/shared/errors/index.js";

const ownerId = "44444444-4444-4444-8444-444444444401";
const otherUserId = "44444444-4444-4444-8444-444444444402";

const session: ShoppingSessionRow = {
  session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
  user_id: ownerId,
  status: "ACTIVE",
  started_at: "2026-09-05T06:00:00.000Z",
  ended_at: null,
  created_at: "2026-09-05T06:00:00.000Z",
};

const intentRow = (
  overrides: Partial<ShoppingIntentRow> = {},
): ShoppingIntentRow => ({
  intent_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
  session_id: session.session_id,
  mandate_id: "77777777-7777-4777-8777-777777777701",
  goal_text: "6 eggs",
  category: "grocery",
  budget_minor: null,
  quality_preference: null,
  status: "CREATED",
  assumptions_json: [],
  created_at: "2026-09-05T06:10:00.000Z",
  updated_at: "2026-09-05T06:10:00.000Z",
  ...overrides,
});

function requirementRow(
  overrides: Partial<RequirementRow> = {},
): RequirementRow {
  return {
    requirement_id: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
    intent_id: intentRow().intent_id,
    item_name: "eggs",
    target_quantity: 6,
    unit: "pieces",
    minimum_quality: null,
    constraints_json: [],
    confidence: 1,
    status: "CREATED",
    created_at: "2026-09-05T06:20:00.000Z",
    updated_at: "2026-09-05T06:20:00.000Z",
    ...overrides,
  };
}

function buildService(options: {
  intent?: ShoppingIntentRow | null;
  session?: ShoppingSessionRow | null;
  existing?: RequirementRow[];
  extraction?: ExtractionResult;
  onInsertMany?: (inputs: unknown[]) => void;
  insertError?: unknown;
}): RequirementsService {
  let stored = options.existing ?? [];

  const requirementsRepository = {
    listByIntentId: async () => stored,
    insertMany: async (inputs: unknown[]) => {
      options.onInsertMany?.(inputs);
      if (options.insertError) {
        throw options.insertError;
      }
      const rows = (inputs as Array<Record<string, unknown>>).map(
        (input, index) =>
          requirementRow({
            requirement_id: `cccccccc-cccc-4ccc-8ccc-cccccccccc${String(index + 1).padStart(2, "0")}`,
            item_name: String(input.item_name),
            target_quantity: Number(input.target_quantity),
            unit: String(input.unit),
            minimum_quality: (input.minimum_quality as string | null) ?? null,
            constraints_json: Array.isArray(input.constraints_json)
              ? input.constraints_json
              : [],
            confidence:
              input.confidence === undefined || input.confidence === null
                ? null
                : Number(input.confidence),
          }),
      );
      stored = rows;
      return rows;
    },
  } as unknown as RequirementsRepository;

  const intentsRepository = {
    findById: async () =>
      options.intent === undefined ? intentRow() : options.intent,
    updateExtractionState: async () =>
      intentRow({ status: "PLANNING", assumptions_json: [] }),
  } as unknown as IntentsRepository;

  const sessionsRepository = {
    findById: async () =>
      options.session === undefined ? session : options.session,
  } as unknown as SessionsRepository;

  const extractor: RequirementExtractor = {
    extract: async () =>
      options.extraction ?? {
        status: "SUCCESS",
        requirements: [
          {
            item_name: "eggs",
            target_quantity: 6,
            unit: "pieces",
            minimum_quality: null,
            constraints_json: [],
            confidence: 1,
          },
        ],
        assumptions: [],
      },
  };

  return new RequirementsService(
    requirementsRepository,
    intentsRepository,
    sessionsRepository,
    extractor,
  );
}

describe("RequirementsService.extractRequirements", () => {
  it("allows extraction for CREATED intents", async () => {
    const service = buildService({ intent: intentRow({ status: "CREATED" }) });
    const result = await service.extractRequirements(
      ownerId,
      intentRow().intent_id,
    );
    expect(result.status).toBe("SUCCESS");
    expect(result.requirements[0].item_name).toBe("eggs");
  });

  it("allows extraction for PLANNING intents", async () => {
    const service = buildService({
      intent: intentRow({ status: "PLANNING" }),
      existing: [requirementRow()],
    });
    const result = await service.extractRequirements(
      ownerId,
      intentRow().intent_id,
    );
    expect(result.status).toBe("SUCCESS");
  });

  it("rejects invalid intent state", async () => {
    const service = buildService({
      intent: intentRow({ status: "CLOSED" }),
    });
    await expect(
      service.extractRequirements(ownerId, intentRow().intent_id),
    ).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
      statusCode: 409,
    });
  });

  it("rejects missing intent", async () => {
    const service = buildService({ intent: null });
    await expect(
      service.extractRequirements(ownerId, intentRow().intent_id),
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      statusCode: 404,
    });
  });

  it("rejects cross-user intent", async () => {
    const service = buildService({
      session: { ...session, user_id: otherUserId },
    });
    await expect(
      service.extractRequirements(ownerId, intentRow().intent_id),
    ).rejects.toMatchObject({
      code: ErrorCodes.FORBIDDEN,
      statusCode: 403,
    });
  });

  it("rejects malformed intent UUID", async () => {
    const service = buildService({});
    await expect(
      service.extractRequirements(ownerId, "intent-001"),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("returns existing requirements without duplicating on repeated extraction", async () => {
    let insertCalls = 0;
    const service = buildService({
      existing: [requirementRow()],
      onInsertMany: () => {
        insertCalls += 1;
      },
    });
    const first = await service.extractRequirements(
      ownerId,
      intentRow().intent_id,
    );
    const second = await service.extractRequirements(
      ownerId,
      intentRow().intent_id,
    );
    expect(first.requirements[0].requirement_id).toBe(
      second.requirements[0].requirement_id,
    );
    expect(insertCalls).toBe(0);
  });

  it("returns clarification without persisting requirements", async () => {
    let insertCalls = 0;
    const service = buildService({
      extraction: {
        status: "CLARIFICATION_REQUIRED",
        requirements: [],
        assumptions: [],
        clarification: {
          question: "What items do you need?",
          reason: "Ambiguous goal",
        },
      },
      onInsertMany: () => {
        insertCalls += 1;
      },
    });
    const result = await service.extractRequirements(
      ownerId,
      intentRow().intent_id,
    );
    expect(result.status).toBe("CLARIFICATION_REQUIRED");
    expect(insertCalls).toBe(0);
  });

  it("rejects invalid extracted drafts before persistence", async () => {
    const service = buildService({
      extraction: {
        status: "SUCCESS",
        requirements: [
          {
            item_name: "eggs",
            target_quantity: 0,
            unit: "pieces",
            minimum_quality: null,
            constraints_json: [],
            confidence: 1,
          },
        ],
        assumptions: [],
      },
    });
    await expect(
      service.extractRequirements(ownerId, intentRow().intent_id),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("persists multiple requirements atomically via insertMany", async () => {
    let inserted: unknown[] = [];
    const service = buildService({
      extraction: {
        status: "SUCCESS",
        requirements: [
          {
            item_name: "eggs",
            target_quantity: 6,
            unit: "pieces",
            minimum_quality: null,
            constraints_json: [],
            confidence: 1,
          },
          {
            item_name: "pasta",
            target_quantity: 2,
            unit: "packs",
            minimum_quality: "acceptable",
            constraints_json: [],
            confidence: 0.94,
          },
        ],
        assumptions: [],
      },
      onInsertMany: (inputs) => {
        inserted = inputs;
      },
    });
    const result = await service.extractRequirements(
      ownerId,
      intentRow().intent_id,
    );
    expect(result.status).toBe("SUCCESS");
    expect(inserted).toHaveLength(2);
    expect(result.requirements).toHaveLength(2);
  });

  it("does not leak internal insert failures", async () => {
    const service = buildService({
      insertError: new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "Failed to insert requirements",
        statusCode: 500,
        expose: false,
      }),
    });
    await expect(
      service.extractRequirements(ownerId, intentRow().intent_id),
    ).rejects.toMatchObject({
      code: ErrorCodes.INTERNAL_ERROR,
      expose: false,
    });
  });
});
