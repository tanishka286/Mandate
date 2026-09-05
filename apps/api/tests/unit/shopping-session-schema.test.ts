import { describe, it, expect } from "vitest";
import {
  SHOPPING_SESSION_STATUSES,
  sessionIdSchema,
  shoppingSessionSchema,
  shoppingSessionStatusSchema,
  userIdSchema,
} from "../../src/modules/sessions/schema.js";

/** Active shopping session fixture (Doc 08: session starts ACTIVE). */
const validActiveSession = {
  session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
  user_id: "44444444-4444-4444-8444-444444444401",
  status: "ACTIVE" as const,
  started_at: "2026-09-05T06:00:00.000Z",
  ended_at: null,
  created_at: "2026-09-05T06:00:00.000Z",
};

/** Ended shopping session fixture. */
const validEndedSession = {
  session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02",
  user_id: "44444444-4444-4444-8444-444444444401",
  status: "ENDED" as const,
  started_at: "2026-09-05T06:00:00.000Z",
  ended_at: "2026-09-05T07:30:00.000Z",
  created_at: "2026-09-05T06:00:00.000Z",
};

describe("shopping session schema validation", () => {
  it("accepts valid ACTIVE and ENDED session fixtures", () => {
    expect(shoppingSessionSchema.parse(validActiveSession).status).toBe(
      "ACTIVE",
    );
    expect(shoppingSessionSchema.parse(validEndedSession).status).toBe(
      "ENDED",
    );
  });

  it("validates session_id and user_id as UUIDs", () => {
    expect(sessionIdSchema.parse(validActiveSession.session_id)).toBe(
      validActiveSession.session_id,
    );
    expect(userIdSchema.parse(validActiveSession.user_id)).toBe(
      validActiveSession.user_id,
    );
  });

  it("rejects malformed session_id and user_id", () => {
    expect(() => sessionIdSchema.parse("session-001")).toThrow();
    expect(() => userIdSchema.parse("user-1")).toThrow();
    expect(() =>
      shoppingSessionSchema.parse({
        ...validActiveSession,
        session_id: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      shoppingSessionSchema.parse({
        ...validActiveSession,
        user_id: "user-1",
      }),
    ).toThrow();
  });

  it("accepts controlled shopping session statuses only", () => {
    for (const status of SHOPPING_SESSION_STATUSES) {
      const row =
        status === "ACTIVE" ? validActiveSession : validEndedSession;
      expect(shoppingSessionStatusSchema.parse(status)).toBe(status);
      expect(shoppingSessionSchema.parse(row).status).toBe(status);
    }
  });

  it("rejects unsupported session statuses", () => {
    expect(() => shoppingSessionStatusSchema.parse("OPEN_SESSION")).toThrow();
    expect(() => shoppingSessionStatusSchema.parse("CANCELLED")).toThrow();
    expect(() => shoppingSessionStatusSchema.parse("CREATED")).toThrow();
    expect(() =>
      shoppingSessionSchema.parse({
        ...validActiveSession,
        status: "PAYMENT_PENDING",
      }),
    ).toThrow();
  });

  it("requires session_id, user_id, status, started_at, and created_at", () => {
    const { session_id: _s, ...missingSessionId } = validActiveSession;
    const { user_id: _u, ...missingUserId } = validActiveSession;
    const { status: _st, ...missingStatus } = validActiveSession;
    const { started_at: _stt, ...missingStartedAt } = validActiveSession;
    const { created_at: _c, ...missingCreatedAt } = validActiveSession;

    expect(() => shoppingSessionSchema.parse(missingSessionId)).toThrow();
    expect(() => shoppingSessionSchema.parse(missingUserId)).toThrow();
    expect(() => shoppingSessionSchema.parse(missingStatus)).toThrow();
    expect(() => shoppingSessionSchema.parse(missingStartedAt)).toThrow();
    expect(() => shoppingSessionSchema.parse(missingCreatedAt)).toThrow();
  });

  it("allows nullable ended_at for ACTIVE sessions", () => {
    expect(
      shoppingSessionSchema.parse(validActiveSession).ended_at,
    ).toBeNull();
  });

  it("requires ended_at when status is ENDED", () => {
    expect(() =>
      shoppingSessionSchema.parse({
        ...validEndedSession,
        ended_at: null,
      }),
    ).toThrow(/ended_at/);
  });

  it("rejects ended_at when status is ACTIVE", () => {
    expect(() =>
      shoppingSessionSchema.parse({
        ...validActiveSession,
        ended_at: "2026-09-05T07:00:00.000Z",
      }),
    ).toThrow(/ended_at/);
  });

  it("accepts UTC timestamp-compatible ISO representations", () => {
    const withFractional = shoppingSessionSchema.parse({
      ...validActiveSession,
      started_at: "2026-09-05T06:00:00.123456Z",
      created_at: "2026-09-05T06:00:00.123456+00:00",
    });
    expect(Date.parse(withFractional.started_at)).not.toBeNaN();
    expect(Date.parse(withFractional.created_at)).not.toBeNaN();

    const ended = shoppingSessionSchema.parse({
      ...validEndedSession,
      ended_at: "2026-09-05T07:30:00.999Z",
    });
    expect(Date.parse(ended.ended_at!)).not.toBeNaN();
  });

  it("rejects malformed timestamps", () => {
    expect(() =>
      shoppingSessionSchema.parse({
        ...validActiveSession,
        started_at: "not-a-timestamp",
      }),
    ).toThrow();
    expect(() =>
      shoppingSessionSchema.parse({
        ...validActiveSession,
        created_at: "",
      }),
    ).toThrow();
  });

  it("does not define out-of-scope Phase 3+ / payment fields", () => {
    const parsed = shoppingSessionSchema.parse(validActiveSession);
    expect(parsed).not.toHaveProperty("currency");
    expect(parsed).not.toHaveProperty("intent_id");
    expect(parsed).not.toHaveProperty("goal_text");
    expect(parsed).not.toHaveProperty("budget_minor");
    expect(parsed).not.toHaveProperty("mandate_id");
    expect(parsed).not.toHaveProperty("policy_decision_id");
    expect(parsed).not.toHaveProperty("razorpay_order_id");
    expect(parsed).not.toHaveProperty("updated_at");
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "created_at",
        "ended_at",
        "session_id",
        "started_at",
        "status",
        "user_id",
      ].sort(),
    );
  });
});
