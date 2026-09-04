import { describe, it, expect } from "vitest";
import { AppError, toSafeClientMessage } from "../../src/shared/errors/index.js";

describe("error safety", () => {
  it("exposes AppError fields safely", () => {
    const err = new AppError({
      code: "VALIDATION_ERROR",
      message: "Safe client-facing message",
      statusCode: 400,
      details: { field: "x" },
    });
    const safe = toSafeClientMessage(err);
    expect(safe).toEqual({
      code: "VALIDATION_ERROR",
      message: "Safe client-facing message",
      details: { field: "x" },
      statusCode: 400,
    });
  });

  it("hides unknown error internals", () => {
    const safe = toSafeClientMessage(new Error("SECRET_DB_PASSWORD leaked"));
    expect(safe.code).toBe("INTERNAL_ERROR");
    expect(safe.message).toBe("An unexpected error occurred");
    expect(safe.message).not.toContain("SECRET");
    expect(safe.details).toEqual({});
  });
});
