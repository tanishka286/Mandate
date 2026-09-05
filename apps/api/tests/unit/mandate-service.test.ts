import { describe, it, expect } from "vitest";
import { MandateService } from "../../src/modules/mandate/service.js";
import type { MandateRepository } from "../../src/modules/mandate/repository.js";
import type {
  MandateCategoryRow,
  MandateRow,
} from "../../src/modules/mandate/types.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";
import { mapDatabaseError } from "../../src/shared/errors/database.js";

const ownerId = "44444444-4444-4444-8444-444444444401";
const otherUserId = "44444444-4444-4444-8444-444444444402";

/** Doc 10 Mandate A — ACTIVE ₹1000 / grocery / ₹300. */
const mandateA: MandateRow = {
  mandate_id: "77777777-7777-4777-8777-777777777701",
  user_id: ownerId,
  agent_id: "agent-001",
  max_spend_minor: 100000,
  currency: "INR",
  max_per_item_minor: 30000,
  purpose: "Mandate A — ₹1000 grocery ceiling",
  valid_until: "2026-12-31T23:59:59.000Z",
  status: "ACTIVE",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

const groceryOnly: MandateCategoryRow[] = [
  { mandate_id: mandateA.mandate_id, category: "grocery" },
];

const multiCategories: MandateCategoryRow[] = [
  { mandate_id: mandateA.mandate_id, category: "dairy" },
  { mandate_id: mandateA.mandate_id, category: "grocery" },
  { mandate_id: mandateA.mandate_id, category: "pantry" },
];

function repositoryMock(options: {
  byId?: MandateRow | null;
  byIdForUser?: MandateRow | null;
  categories?: MandateCategoryRow[];
  onFindById?: (id: string) => void;
}): MandateRepository {
  return {
    findById: async (mandateId: string) => {
      options.onFindById?.(mandateId);
      if (options.byId === undefined) {
        return mandateId === mandateA.mandate_id ? mandateA : null;
      }
      return options.byId;
    },
    findByIdForUser: async (mandateId: string, userId: string) => {
      if (options.byIdForUser !== undefined) {
        return options.byIdForUser;
      }
      const row =
        options.byId === undefined
          ? mandateId === mandateA.mandate_id
            ? mandateA
            : null
          : options.byId;
      if (!row || row.user_id !== userId) {
        return null;
      }
      return row;
    },
    listCategoriesByMandateId: async () => options.categories ?? groceryOnly,
  } as unknown as MandateRepository;
}

describe("MandateService retrieval", () => {
  it("retrieves an existing active mandate for the authenticated owner", async () => {
    const service = new MandateService(repositoryMock({}));
    const mandate = await service.getMandateForUser(ownerId, mandateA.mandate_id);

    expect(mandate.mandate_id).toBe(mandateA.mandate_id);
    expect(mandate.status).toBe("ACTIVE");
    expect(mandate.user_id).toBe(ownerId);
  });

  it("includes allowed categories from mandate_category", async () => {
    const service = new MandateService(repositoryMock({}));
    const mandate = await service.getMandateForUser(ownerId, mandateA.mandate_id);
    expect(mandate.allowed_categories).toEqual(["grocery"]);
  });

  it("loads multiple allowed categories correctly", async () => {
    const service = new MandateService(
      repositoryMock({ categories: multiCategories }),
    );
    const mandate = await service.getMandateForUser(ownerId, mandateA.mandate_id);
    expect(mandate.allowed_categories).toEqual(["dairy", "grocery", "pantry"]);
  });

  it("rejects an unknown mandate", async () => {
    const service = new MandateService(
      repositoryMock({ byId: null, byIdForUser: null }),
    );
    await expect(
      service.getMandateForUser(
        ownerId,
        "77777777-7777-4777-8777-777777777799",
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.MANDATE_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("rejects a mandate belonging to another user", async () => {
    const service = new MandateService(
      repositoryMock({
        byId: mandateA,
        byIdForUser: null,
      }),
    );
    await expect(
      service.getMandateForUser(otherUserId, mandateA.mandate_id),
    ).rejects.toMatchObject({
      code: ErrorCodes.MANDATE_UNAUTHORIZED,
      statusCode: 403,
    });
  });

  it("preserves max_spend_minor exactly", async () => {
    const service = new MandateService(repositoryMock({}));
    const mandate = await service.getMandateForUser(ownerId, mandateA.mandate_id);
    expect(mandate.max_spend_minor).toBe(100000);
  });

  it("preserves max_per_item_minor exactly", async () => {
    const service = new MandateService(repositoryMock({}));
    const mandate = await service.getMandateForUser(ownerId, mandateA.mandate_id);
    expect(mandate.max_per_item_minor).toBe(30000);
  });

  it("preserves currency as INR", async () => {
    const service = new MandateService(repositoryMock({}));
    const mandate = await service.getMandateForUser(ownerId, mandateA.mandate_id);
    expect(mandate.currency).toBe("INR");
  });
});

describe("MandateService authorization validation", () => {
  const beforeExpiry = new Date("2026-10-01T00:00:00.000Z");

  it("accepts an ACTIVE mandate before valid_until", async () => {
    const service = new MandateService(repositoryMock({}));
    const mandate = await service.requireValidMandateForAuthorization(
      ownerId,
      mandateA.mandate_id,
      beforeExpiry,
    );
    expect(mandate.status).toBe("ACTIVE");
    expect(mandate.max_spend_minor).toBe(100000);
  });

  it("rejects an EXPIRED mandate", async () => {
    const expired: MandateRow = {
      ...mandateA,
      status: "EXPIRED",
      valid_until: "2026-01-01T00:00:00.000Z",
    };
    const service = new MandateService(
      repositoryMock({ byId: expired, byIdForUser: expired }),
    );
    await expect(
      service.requireValidMandateForAuthorization(
        ownerId,
        expired.mandate_id,
        beforeExpiry,
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.MANDATE_INVALID,
      statusCode: 422,
      details: { status: "EXPIRED" },
    });
  });

  it("rejects a REVOKED mandate", async () => {
    const revoked: MandateRow = { ...mandateA, status: "REVOKED" };
    const service = new MandateService(
      repositoryMock({ byId: revoked, byIdForUser: revoked }),
    );
    await expect(
      service.requireValidMandateForAuthorization(
        ownerId,
        revoked.mandate_id,
        beforeExpiry,
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.MANDATE_INVALID,
      details: { status: "REVOKED" },
    });
  });

  it("rejects a CLOSED mandate for new authorization", async () => {
    const closed: MandateRow = { ...mandateA, status: "CLOSED" };
    const service = new MandateService(
      repositoryMock({ byId: closed, byIdForUser: closed }),
    );
    await expect(
      service.requireValidMandateForAuthorization(
        ownerId,
        closed.mandate_id,
        beforeExpiry,
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.MANDATE_INVALID,
      details: { status: "CLOSED" },
    });
  });

  it("rejects an ACTIVE mandate at or after valid_until", async () => {
    const service = new MandateService(repositoryMock({}));
    await expect(
      service.requireValidMandateForAuthorization(
        ownerId,
        mandateA.mandate_id,
        new Date("2026-12-31T23:59:59.000Z"),
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.MANDATE_INVALID,
      message: "Mandate has expired",
    });
  });

  it("rejects CREATED mandates for authorization", async () => {
    const created: MandateRow = { ...mandateA, status: "CREATED" };
    const service = new MandateService(
      repositoryMock({ byId: created, byIdForUser: created }),
    );
    await expect(
      service.requireValidMandateForAuthorization(
        ownerId,
        created.mandate_id,
        beforeExpiry,
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.MANDATE_INVALID,
      details: { status: "CREATED" },
    });
  });
});

describe("MandateService mutation surface", () => {
  it("does not expose mandate authority mutation methods", () => {
    const proto = MandateService.prototype as Record<string, unknown>;
    const forbidden = [
      "create",
      "createMandate",
      "update",
      "updateMandate",
      "revoke",
      "revokeMandate",
      "delete",
      "deleteMandate",
      "extendValidUntil",
      "increaseMaxSpend",
      "addCategory",
      "setMaxPerItem",
    ];
    for (const name of forbidden) {
      expect(typeof proto[name]).toBe("undefined");
    }
  });
});

describe("mandate database error mapping", () => {
  it("does not expose raw database errors", () => {
    const err = mapDatabaseError({
      code: "42P01",
      message: 'relation "mandate" does not exist — secret internals',
    });
    expect(err.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(err.statusCode).toBe(500);
    expect(err.expose).toBe(false);
    expect(err.message).not.toContain("secret");
    expect(err.message).not.toContain("42P01");
  });

  it("maps repository fallback messages without leaking SQL", () => {
    const err = mapDatabaseError(
      { code: "57014", message: "canceling statement due to statement timeout" },
      "Failed to load mandate",
    );
    expect(err.message).toBe("Failed to load mandate");
    expect(err.expose).toBe(false);
  });
});
