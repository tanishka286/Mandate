import { describe, it, expect } from "vitest";
import {
  PAYMENT_STATES,
  TERMINAL_PAYMENT_STATES,
  canTransitionPaymentState,
  transitionPaymentState,
  assertCanTransitionPaymentState,
  isPaymentState,
  isTerminalPaymentState,
  type PaymentState,
} from "../../src/modules/payments/state-machine.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";

describe("Payment State Machine", () => {
  describe("isPaymentState", () => {
    it("recognizes all valid payment states", () => {
      for (const s of PAYMENT_STATES) {
        expect(isPaymentState(s)).toBe(true);
      }
    });

    it("rejects unknown or invalid states", () => {
      expect(isPaymentState("OPEN_CART")).toBe(false);
      expect(isPaymentState("COMPLETED")).toBe(false);
      expect(isPaymentState("PAID")).toBe(false);
      expect(isPaymentState(null)).toBe(false);
      expect(isPaymentState(undefined)).toBe(false);
      expect(isPaymentState(123)).toBe(false);
    });
  });

  describe("isTerminalPaymentState", () => {
    it("recognizes terminal states", () => {
      expect(isTerminalPaymentState("VERIFIED")).toBe(true);
      expect(isTerminalPaymentState("FAILED")).toBe(true);
      expect(isTerminalPaymentState("CANCELLED")).toBe(true);
      expect(isTerminalPaymentState("EXPIRED")).toBe(true);
      expect(isTerminalPaymentState("PAYMENT_PENDING")).toBe(false);
    });
  });

  describe("Valid transitions from PAYMENT_PENDING", () => {
    it("allows PAYMENT_PENDING -> PAYMENT_PENDING (same-state idempotency)", () => {
      expect(canTransitionPaymentState("PAYMENT_PENDING", "PAYMENT_PENDING")).toBe(true);
      expect(transitionPaymentState("PAYMENT_PENDING", "PAYMENT_PENDING")).toBe("PAYMENT_PENDING");
    });

    it("allows PAYMENT_PENDING -> VERIFIED", () => {
      expect(canTransitionPaymentState("PAYMENT_PENDING", "VERIFIED")).toBe(true);
      expect(transitionPaymentState("PAYMENT_PENDING", "VERIFIED")).toBe("VERIFIED");
    });

    it("allows PAYMENT_PENDING -> FAILED", () => {
      expect(canTransitionPaymentState("PAYMENT_PENDING", "FAILED")).toBe(true);
      expect(transitionPaymentState("PAYMENT_PENDING", "FAILED")).toBe("FAILED");
    });

    it("allows PAYMENT_PENDING -> CANCELLED", () => {
      expect(canTransitionPaymentState("PAYMENT_PENDING", "CANCELLED")).toBe(true);
      expect(transitionPaymentState("PAYMENT_PENDING", "CANCELLED")).toBe("CANCELLED");
    });

    it("allows PAYMENT_PENDING -> EXPIRED", () => {
      expect(canTransitionPaymentState("PAYMENT_PENDING", "EXPIRED")).toBe(true);
      expect(transitionPaymentState("PAYMENT_PENDING", "EXPIRED")).toBe("EXPIRED");
    });
  });

  describe("Same-state idempotency for all terminal states", () => {
    it.each(TERMINAL_PAYMENT_STATES)(
      "allows same-state transition for %s as an idempotent no-op",
      (state) => {
        expect(canTransitionPaymentState(state, state)).toBe(true);
        expect(transitionPaymentState(state, state)).toBe(state);
      },
    );
  });

  describe("VERIFIED terminality", () => {
    const invalidTargets: PaymentState[] = [
      "PAYMENT_PENDING",
      "FAILED",
      "CANCELLED",
      "EXPIRED",
    ];

    it.each(invalidTargets)(
      "rejects transition from terminal VERIFIED -> %s",
      (target) => {
        expect(canTransitionPaymentState("VERIFIED", target)).toBe(false);
        expect(() => transitionPaymentState("VERIFIED", target)).toThrowError(AppError);
        try {
          transitionPaymentState("VERIFIED", target);
        } catch (err) {
          const appErr = err as AppError;
          expect(appErr.code).toBe(ErrorCodes.CONFLICT);
          expect(appErr.statusCode).toBe(409);
        }
      },
    );
  });

  describe("FAILED terminality", () => {
    const invalidTargets: PaymentState[] = [
      "PAYMENT_PENDING",
      "VERIFIED",
      "CANCELLED",
      "EXPIRED",
    ];

    it.each(invalidTargets)(
      "rejects transition from terminal FAILED -> %s",
      (target) => {
        expect(canTransitionPaymentState("FAILED", target)).toBe(false);
        expect(() => transitionPaymentState("FAILED", target)).toThrowError(AppError);
      },
    );
  });

  describe("CANCELLED terminality", () => {
    const invalidTargets: PaymentState[] = [
      "PAYMENT_PENDING",
      "VERIFIED",
      "FAILED",
      "EXPIRED",
    ];

    it.each(invalidTargets)(
      "rejects transition from terminal CANCELLED -> %s",
      (target) => {
        expect(canTransitionPaymentState("CANCELLED", target)).toBe(false);
        expect(() => transitionPaymentState("CANCELLED", target)).toThrowError(AppError);
      },
    );
  });

  describe("EXPIRED terminality", () => {
    const invalidTargets: PaymentState[] = [
      "PAYMENT_PENDING",
      "VERIFIED",
      "FAILED",
      "CANCELLED",
    ];

    it.each(invalidTargets)(
      "rejects transition from terminal EXPIRED -> %s",
      (target) => {
        expect(canTransitionPaymentState("EXPIRED", target)).toBe(false);
        expect(() => transitionPaymentState("EXPIRED", target)).toThrowError(AppError);
      },
    );
  });

  describe("Invalid state inputs and assertions", () => {
    it("throws VALIDATION_ERROR (400) for invalid from state", () => {
      expect(() => transitionPaymentState("INVALID_FROM", "VERIFIED")).toThrowError(AppError);
      try {
        transitionPaymentState("INVALID_FROM", "VERIFIED");
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(appErr.statusCode).toBe(400);
      }
    });

    it("throws VALIDATION_ERROR (400) for invalid to state", () => {
      expect(() => transitionPaymentState("PAYMENT_PENDING", "INVALID_TO")).toThrowError(AppError);
      try {
        transitionPaymentState("PAYMENT_PENDING", "INVALID_TO");
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(appErr.statusCode).toBe(400);
      }
    });

    it("assertCanTransitionPaymentState passes for valid transition", () => {
      expect(() =>
        assertCanTransitionPaymentState("PAYMENT_PENDING", "VERIFIED"),
      ).not.toThrow();
    });

    it("assertCanTransitionPaymentState throws for invalid transition", () => {
      expect(() =>
        assertCanTransitionPaymentState("VERIFIED", "PAYMENT_PENDING"),
      ).toThrowError(AppError);
    });
  });
});
