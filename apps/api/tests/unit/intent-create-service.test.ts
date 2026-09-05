import { describe, it, expect } from "vitest";
import { IntentsService } from "../../src/modules/intents/service.js";
import type { IntentsRepository } from "../../src/modules/intents/repository.js";
import type { SessionsRepository } from "../../src/modules/sessions/repository.js";
import type { MandateService } from "../../src/modules/mandate/service.js";
import type { ShoppingIntentRow } from "../../src/modules/intents/types.js";
import type { ShoppingSessionRow } from "../../src/modules/sessions/types.js";
import type { MandateWithCategories } from "../../src/modules/mandate/schema.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { AppError } from "../../src/shared/errors/index.js";
import { mapDatabaseError } from "../../src/shared/errors/database.js";

const ownerId = "44444444-4444-4444-8444-444444444401";
const otherUserId = "44444444-4444-4444-8444-444444444402";

const activeSession: ShoppingSessionRow = {
  session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
  user_id: ownerId,
  status: "ACTIVE",
  started_at: "2026-09-05T06:00:00.000Z",
  ended_at: null,
  created_at: "2026-09-05T06:00:00.000Z",
};

const endedSession: ShoppingSessionRow = {
  ...activeSession,
  session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02",
  status: "ENDED",
  ended_at: "2026-09-05T07:00:00.000Z",
};

const otherUserSession: ShoppingSessionRow = {
  ...activeSession,
  session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03",
  user_id: otherUserId,
};

const mandateA: MandateWithCategories = {
  mandate_id: "77777777-7777-4777-8777-777777777701",
  user_id: ownerId,
  agent_id: "agent-001",
  max_spend_minor: 100000,
  currency: "INR",
  max_per_item_minor: 30000,
  purpose: "Mandate A",
  valid_until: "2026-12-31T23:59:59.000Z",
  status: "ACTIVE",
  allowed_categories: ["grocery"],
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

const validBody = {
  goal_text: "Pasta for 4, budget ₹1000",
  budget_minor: 100000,
  category: "grocery",
  quality_preference: null as string | null,
  constraints: [] as unknown[],
  mandate_id: mandateA.mandate_id,
};

function intentRow(
  overrides: Partial<ShoppingIntentRow> = {},
): ShoppingIntentRow {
  return {
    intent_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
    session_id: activeSession.session_id,
    mandate_id: mandateA.mandate_id,
    goal_text: validBody.goal_text,
    category: "grocery",
    budget_minor: 100000,
    quality_preference: null,
    status: "CREATED",
    assumptions_json: [],
    created_at: "2026-09-05T06:10:00.000Z",
    updated_at: "2026-09-05T06:10:00.000Z",
    ...overrides,
  };
}

function buildService(options: {
  session?: ShoppingSessionRow | null;
  onInsert?: (input: unknown) => void;
  insertResult?: ShoppingIntentRow;
  mandateError?: AppError;
  mandate?: MandateWithCategories;
  insertError?: unknown;
}): IntentsService {
  const sessionsRepository = {
    findById: async () =>
      options.session === undefined ? activeSession : options.session,
  } as unknown as SessionsRepository;

  const intentsRepository = {
    insert: async (input: unknown) => {
      options.onInsert?.(input);
      if (options.insertError) {
        throw options.insertError;
      }
      return options.insertResult ?? intentRow();
    },
    findById: async () => options.insertResult ?? intentRow(),
  } as unknown as IntentsRepository;

  const mandateService = {
    requireValidMandateForAuthorization: async (
      userId: string,
      mandateId: string,
    ) => {
      if (options.mandateError) {
        throw options.mandateError;
      }
      const mandate = options.mandate ?? mandateA;
      if (mandate.user_id !== userId || mandate.mandate_id !== mandateId) {
        throw new AppError({
          code: ErrorCodes.MANDATE_UNAUTHORIZED,
          message: "Mandate does not belong to the authenticated user",
          statusCode: 403,
        });
      }
      return mandate;
    },
  } as unknown as MandateService;

  return new IntentsService(
    intentsRepository,
    sessionsRepository,
    mandateService,
  );
}

describe("IntentsService.createIntent", () => {
  it("creates an intent for a valid ACTIVE owned session", async () => {
    const service = buildService({});
    const result = await service.createIntent(
      ownerId,
      activeSession.session_id,
      validBody,
    );
    expect(result.status).toBe("CREATED");
    expect(result.session_id).toBe(activeSession.session_id);
    expect(result.mandate_id).toBe(mandateA.mandate_id);
    expect(result.intent_id).toBeTruthy();
  });

  it("returns status CREATED (does not auto-advance to PLANNING)", async () => {
    const service = buildService({});
    const result = await service.createIntent(
      ownerId,
      activeSession.session_id,
      validBody,
    );
    expect(result.status).toBe("CREATED");
  });

  it("returns session_id matching the route session", async () => {
    const service = buildService({});
    const result = await service.createIntent(
      ownerId,
      activeSession.session_id,
      validBody,
    );
    expect(result.session_id).toBe(activeSession.session_id);
  });

  it("returns authoritative mandate_id from validated mandate context", async () => {
    const service = buildService({});
    const result = await service.createIntent(
      ownerId,
      activeSession.session_id,
      validBody,
    );
    expect(result.mandate_id).toBe(mandateA.mandate_id);
  });

  it("preserves goal_text, budget_minor, category, and quality_preference", async () => {
    let inserted: Record<string, unknown> | undefined;
    const body = {
      ...validBody,
      goal_text: "Pasta for 4, budget ₹1000",
      budget_minor: 100000,
      category: "grocery",
      quality_preference: "premium",
      constraints: [{ type: "brand", value: "Acme" }],
    };
    const service = buildService({
      onInsert: (input) => {
        inserted = input as Record<string, unknown>;
      },
      insertResult: intentRow({
        goal_text: body.goal_text,
        budget_minor: body.budget_minor,
        category: body.category,
        quality_preference: body.quality_preference,
        assumptions_json: [],
      }),
    });

    await service.createIntent(ownerId, activeSession.session_id, body);

    expect(inserted?.goal_text).toBe("Pasta for 4, budget ₹1000");
    expect(inserted?.budget_minor).toBe(100000);
    expect(inserted?.category).toBe("grocery");
    expect(inserted?.quality_preference).toBe("premium");
    expect(inserted?.assumptions_json).toEqual([]);
  });

  it("handles empty constraints without writing them to assumptions_json", async () => {
    let inserted: Record<string, unknown> | undefined;
    const service = buildService({
      onInsert: (input) => {
        inserted = input as Record<string, unknown>;
      },
    });
    await service.createIntent(ownerId, activeSession.session_id, validBody);
    expect(inserted?.assumptions_json).toEqual([]);
  });

  it("rejects ENDED sessions", async () => {
    const service = buildService({ session: endedSession });
    await expect(
      service.createIntent(ownerId, endedSession.session_id, validBody),
    ).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
      statusCode: 409,
    });
  });

  it("rejects missing sessions", async () => {
    const service = buildService({ session: null });
    await expect(
      service.createIntent(ownerId, activeSession.session_id, validBody),
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      statusCode: 404,
    });
  });

  it("rejects cross-user session access", async () => {
    const service = buildService({ session: otherUserSession });
    await expect(
      service.createIntent(ownerId, otherUserSession.session_id, validBody),
    ).rejects.toMatchObject({
      code: ErrorCodes.FORBIDDEN,
      statusCode: 403,
    });
  });

  it("rejects missing/unresolvable mandate", async () => {
    const service = buildService({
      mandateError: new AppError({
        code: ErrorCodes.MANDATE_NOT_FOUND,
        message: "Mandate not found",
        statusCode: 404,
      }),
    });
    await expect(
      service.createIntent(ownerId, activeSession.session_id, {
        ...validBody,
        mandate_id: "77777777-7777-4777-8777-777777777799",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.MANDATE_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("rejects cross-user mandate context", async () => {
    const service = buildService({
      mandateError: new AppError({
        code: ErrorCodes.MANDATE_UNAUTHORIZED,
        message: "Mandate does not belong to the authenticated user",
        statusCode: 403,
      }),
    });
    await expect(
      service.createIntent(ownerId, activeSession.session_id, validBody),
    ).rejects.toMatchObject({
      code: ErrorCodes.MANDATE_UNAUTHORIZED,
      statusCode: 403,
    });
  });

  it("rejects invalid goal_text", async () => {
    const service = buildService({});
    await expect(
      service.createIntent(ownerId, activeSession.session_id, {
        ...validBody,
        goal_text: "   ",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("rejects negative budget_minor", async () => {
    const service = buildService({});
    await expect(
      service.createIntent(ownerId, activeSession.session_id, {
        ...validBody,
        budget_minor: -1,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("rejects floating-point budget_minor", async () => {
    const service = buildService({});
    await expect(
      service.createIntent(ownerId, activeSession.session_id, {
        ...validBody,
        budget_minor: 1000.5,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("rejects invalid category", async () => {
    const service = buildService({});
    await expect(
      service.createIntent(ownerId, activeSession.session_id, {
        ...validBody,
        category: "  ",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("rejects invalid quality_preference", async () => {
    const service = buildService({});
    await expect(
      service.createIntent(ownerId, activeSession.session_id, {
        ...validBody,
        quality_preference: "   ",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("rejects malformed session UUID", async () => {
    const service = buildService({});
    await expect(
      service.createIntent(ownerId, "session-001", validBody),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("does not leak internal database error details", async () => {
    const service = buildService({
      insertError: mapDatabaseError(
        { message: "password=super-secret connection failed", code: "XX000" },
        "Failed to insert shopping intent",
      ),
    });

    await expect(
      service.createIntent(ownerId, activeSession.session_id, validBody),
    ).rejects.toSatisfy((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toMatch(/password|super-secret/i);
      return true;
    });
  });
});

describe("createShoppingIntentBodySchema mandate_id requirement", () => {
  it("rejects create body without mandate_id (cannot auto-resolve among ACTIVE mandates)", () => {
    const service = buildService({});
    const { mandate_id: _m, ...withoutMandate } = validBody;
    expect(() => service.normalizeCreateBody(withoutMandate)).toThrow();
  });
});
