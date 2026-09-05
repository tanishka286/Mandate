import { describe, it, expect } from "vitest";
import { mapDatabaseError } from "../../src/shared/errors/database.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";

describe("mapDatabaseError", () => {
  it("maps unique_violation to CONFLICT (duplicate category protection)", () => {
    const err = mapDatabaseError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "category_code_unique"',
    });

    expect(err.code).toBe(ErrorCodes.CONFLICT);
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("Resource already exists");
    expect(err.details).toEqual({ constraint: "unique" });
  });

  it("maps foreign_key_violation to VALIDATION_ERROR", () => {
    const err = mapDatabaseError({
      code: "23503",
      message:
        'insert or update on table "product" violates foreign key constraint',
    });

    expect(err.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ constraint: "foreign_key" });
  });

  it("hides unknown database errors", () => {
    const err = mapDatabaseError({
      code: "42P01",
      message: 'relation "secret_table" does not exist',
    });

    expect(err.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(err.statusCode).toBe(500);
    expect(err.expose).toBe(false);
    expect(err.message).not.toContain("secret_table");
  });
});
