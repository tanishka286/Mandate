import { describe, it, expect, vi } from "vitest";
import {
  RazorpayServerAdapter,
  buildOrderReceipt,
  type RazorpayClientLike,
  type CreateRazorpayOrderInput,
} from "../../src/modules/payments/razorpay-adapter.js";
import { AppError } from "../../src/shared/errors/index.js";
import { ErrorCodes } from "../../src/shared/constants/index.js";

describe("RazorpayServerAdapter (Test Mode)", () => {
  const dummyKeySecret = "rzp_test_secret_abc123";

  function createMockClient(
    overrideFn?: (params: unknown) => Promise<unknown>,
  ): RazorpayClientLike {
    return {
      orders: {
        create: vi.fn().mockImplementation(
          overrideFn ??
            (async (params: { amount: number; currency: string; receipt: string }) => {
              return {
                id: "order_mock12345",
                entity: "order",
                amount: params.amount,
                currency: params.currency,
                receipt: params.receipt,
                status: "created",
              };
            }),
        ),
      },
    };
  }

  // 1. INR amount is passed in minor units without alteration
  describe("1. INR amount in minor units", () => {
    it("passes minor units (paise) directly to provider without alteration or float conversion", async () => {
      const mockClient = createMockClient();
      const adapter = new RazorpayServerAdapter({
        client: mockClient,
        keySecret: dummyKeySecret,
      });

      const input: CreateRazorpayOrderInput = {
        amount_minor: 87400, // ₹874
        currency: "INR",
        receipt: "rcpt_order_123",
      };

      const result = await adapter.createRazorpayOrder(input);

      expect(mockClient.orders.create).toHaveBeenCalledWith({
        amount: 87400,
        currency: "INR",
        receipt: "rcpt_order_123",
      });
      expect(result.amount).toBe(87400);
    });

    it("rejects non-integer floating point amounts", async () => {
      const mockClient = createMockClient();
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      await expect(
        adapter.createRazorpayOrder({
          amount_minor: 874.5 as unknown as number,
          currency: "INR",
          receipt: "rcpt_123",
        }),
      ).rejects.toThrowError(AppError);
    });

    it("rejects zero or negative amounts", async () => {
      const mockClient = createMockClient();
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      await expect(
        adapter.createRazorpayOrder({
          amount_minor: 0,
          currency: "INR",
          receipt: "rcpt_123",
        }),
      ).rejects.toThrowError(AppError);

      await expect(
        adapter.createRazorpayOrder({
          amount_minor: -500,
          currency: "INR",
          receipt: "rcpt_123",
        }),
      ).rejects.toThrowError(AppError);
    });
  });

  // 2. Currency is INR
  describe("2. Currency rule", () => {
    it("passes currency as INR to provider", async () => {
      const mockClient = createMockClient();
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      const result = await adapter.createRazorpayOrder({
        amount_minor: 15000,
        currency: "INR",
        receipt: "rcpt_order_currency",
      });

      expect(result.currency).toBe("INR");
      expect(mockClient.orders.create).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "INR" }),
      );
    });

    it("rejects non-INR currencies", async () => {
      const mockClient = createMockClient();
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      await expect(
        adapter.createRazorpayOrder({
          amount_minor: 1000,
          currency: "USD" as "INR",
          receipt: "rcpt_usd",
        }),
      ).rejects.toThrowError(AppError);
    });
  });

  // 3. Receipt is passed correctly
  describe("3. Receipt handling", () => {
    it("passes receipt correctly and supports buildOrderReceipt helper", async () => {
      const orderId = "44444444-4444-4444-8444-444444444401";
      const receipt = buildOrderReceipt(orderId);

      expect(receipt.length).toBeLessThanOrEqual(40);
      expect(receipt).toMatch(/^rcpt_[a-f0-9]+$/);
      expect(receipt).not.toContain("-");

      const mockClient = createMockClient();
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      const result = await adapter.createRazorpayOrder({
        amount_minor: 2500,
        currency: "INR",
        receipt,
      });

      expect(mockClient.orders.create).toHaveBeenCalledWith(
        expect.objectContaining({ receipt }),
      );
      expect(result.receipt).toBe(receipt);
    });

    it("rejects empty or overly long receipts", async () => {
      const mockClient = createMockClient();
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      await expect(
        adapter.createRazorpayOrder({
          amount_minor: 1000,
          currency: "INR",
          receipt: "   ",
        }),
      ).rejects.toThrowError(AppError);

      await expect(
        adapter.createRazorpayOrder({
          amount_minor: 1000,
          currency: "INR",
          receipt: "a".repeat(45), // exceeds 40 chars
        }),
      ).rejects.toThrowError(AppError);
    });
  });

  // 4. Provider order ID is returned correctly
  describe("4. Provider order ID returned", () => {
    it("returns razorpay_order_id from provider response", async () => {
      const mockClient = createMockClient(async () => ({
        id: "order_rzp_live_test_7788",
        amount: 3200,
        currency: "INR",
        receipt: "rcpt_3200",
        status: "created",
      }));
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      const result = await adapter.createRazorpayOrder({
        amount_minor: 3200,
        currency: "INR",
        receipt: "rcpt_3200",
      });

      expect(result.razorpay_order_id).toBe("order_rzp_live_test_7788");
      expect(result.status).toBe("created");
    });
  });

  // 5. Provider failure is converted to structured application error
  describe("5. Provider failure error conversion", () => {
    it("converts provider API rejection into structured AppError (502)", async () => {
      const mockClient = createMockClient(async () => {
        const err = new Error("Gateway error");
        (err as unknown as { error: { code: string; description: string } }).error = {
          code: "BAD_REQUEST_ERROR",
          description: "Order amount exceeds limit",
        };
        throw err;
      });
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      await expect(
        adapter.createRazorpayOrder({
          amount_minor: 5000,
          currency: "INR",
          receipt: "rcpt_fail",
        }),
      ).rejects.toThrowError(AppError);

      try {
        await adapter.createRazorpayOrder({
          amount_minor: 5000,
          currency: "INR",
          receipt: "rcpt_fail",
        });
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe("PAYMENT_PROVIDER_ERROR");
        expect(appErr.statusCode).toBe(502);
        expect(appErr.message).toContain("Order amount exceeds limit");
      }
    });

    it("converts provider timeout into retry/reconciliation-safe error (504)", async () => {
      const mockClient = createMockClient(async () => {
        const timeoutErr = new Error("Connection timeout");
        (timeoutErr as unknown as { code: string }).code = "ECONNABORTED";
        throw timeoutErr;
      });
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      try {
        await adapter.createRazorpayOrder({
          amount_minor: 5000,
          currency: "INR",
          receipt: "rcpt_timeout",
        });
        expect.unreachable("Should have thrown timeout AppError");
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe("PAYMENT_PROVIDER_TIMEOUT");
        expect(appErr.statusCode).toBe(504);
        expect(appErr.details.is_timeout).toBe(true);
      }
    });
  });

  // 6. Missing provider order ID fails closed
  describe("6. Missing provider order ID fails closed", () => {
    it("fails closed when provider returns empty or missing order ID", async () => {
      const mockClient = createMockClient(async () => ({
        id: "",
        amount: 5000,
        currency: "INR",
      }));
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      await expect(
        adapter.createRazorpayOrder({
          amount_minor: 5000,
          currency: "INR",
          receipt: "rcpt_empty_id",
        }),
      ).rejects.toThrowError(AppError);

      try {
        await adapter.createRazorpayOrder({
          amount_minor: 5000,
          currency: "INR",
          receipt: "rcpt_empty_id",
        });
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe("PAYMENT_PROVIDER_MALFORMED_RESPONSE");
        expect(appErr.statusCode).toBe(502);
      }
    });

    it("fails closed when provider returns non-object", async () => {
      const mockClient = createMockClient(async () => null as unknown as object);
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      await expect(
        adapter.createRazorpayOrder({
          amount_minor: 5000,
          currency: "INR",
          receipt: "rcpt_null",
        }),
      ).rejects.toThrowError(AppError);
    });
  });

  // 7. Secrets are never included in thrown/logged errors
  describe("7. Secrets protection in errors", () => {
    it("redacts secret credentials if present in provider error message", async () => {
      const mockClient = createMockClient(async () => {
        throw new Error(
          `Authentication failed with key_secret=${dummyKeySecret} for user`,
        );
      });
      const adapter = new RazorpayServerAdapter({
        client: mockClient,
        keySecret: dummyKeySecret,
      });

      try {
        await adapter.createRazorpayOrder({
          amount_minor: 5000,
          currency: "INR",
          receipt: "rcpt_secret",
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.message).not.toContain(dummyKeySecret);
        expect(appErr.message).toContain("[REDACTED]");
        expect(JSON.stringify(appErr.details)).not.toContain(dummyKeySecret);
      }
    });
  });

  // 8. Adapter does not calculate or accept a separate client amount
  describe("8. Amount authority", () => {
    it("uses authoritative amount_minor directly and does not alter or recompute amount", async () => {
      const mockClient = createMockClient();
      const adapter = new RazorpayServerAdapter({ client: mockClient });

      const inputWithPotentialExtraFields = {
        amount_minor: 12500,
        currency: "INR" as const,
        receipt: "rcpt_authoritative",
        client_amount: 10000, // untrusted client attempt
        discount: 2500, // untrusted discount attempt
      };

      await adapter.createRazorpayOrder(inputWithPotentialExtraFields);

      // Verify the provider strictly received the authorized amount_minor (12500)
      expect(mockClient.orders.create).toHaveBeenCalledWith({
        amount: 12500,
        currency: "INR",
        receipt: "rcpt_authoritative",
      });
    });
  });

  // 9. Adapter is server-side only
  describe("9. Server-side boundary", () => {
    it("keeps secret private and does not leak credentials on adapter instance or return value", async () => {
      const mockClient = createMockClient();
      const adapter = new RazorpayServerAdapter({
        client: mockClient,
        keySecret: dummyKeySecret,
      });

      const result = await adapter.createRazorpayOrder({
        amount_minor: 5000,
        currency: "INR",
        receipt: "rcpt_server_only",
      });

      // Result contains only safe provider fields
      expect(result).toHaveProperty("razorpay_order_id");
      expect(result).toHaveProperty("amount");
      expect(result).toHaveProperty("currency");
      expect(result).toHaveProperty("receipt");
      expect(result).toHaveProperty("status");
      expect(result).not.toHaveProperty("key_secret");
      expect(result).not.toHaveProperty("secret");
      expect(Object.keys(result).sort()).toEqual([
        "amount",
        "currency",
        "razorpay_order_id",
        "receipt",
        "status",
      ]);
    });
  });

  // 10. Test Mode configuration is required
  describe("10. Test Mode requirement", () => {
    it("rejects non-test environment mode", () => {
      expect(() => {
        new RazorpayServerAdapter({
          client: createMockClient(),
          env: "live" as unknown as "test",
        });
      }).toThrowError(AppError);

      try {
        new RazorpayServerAdapter({
          client: createMockClient(),
          env: "production" as unknown as "test",
        });
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(appErr.message).toContain("Test Mode");
      }
    });

    it("throws INTERNAL_ERROR when unmocked client has missing credentials", () => {
      expect(() => {
        new RazorpayServerAdapter({
          keyId: "",
          keySecret: "",
          env: "test",
        });
      }).toThrowError(AppError);
    });
  });
});
