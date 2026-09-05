import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Phase 8 frontend checkout boundary", () => {
  it("1. frontend api client never sends client-controlled checkout amount", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/services/api-client.ts"),
      "utf8",
    );
    expect(source).toContain("createCheckout");
    expect(source).not.toMatch(/amount_minor:\s*[^}]+client/i);
    expect(source).not.toContain("RAZORPAY_KEY_SECRET");
    expect(source).not.toContain("RAZORPAY_WEBHOOK_SECRET");
  });

  it("2. checkout panel uses backend-created Razorpay order and public key only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/CheckoutPaymentPanel.tsx"),
      "utf8",
    );
    expect(source).toContain("handoff.razorpay_key_id");
    expect(source).toContain("handoff.razorpay_order_id");
    expect(source).toContain("handoff.amount_minor");
    expect(source).not.toContain("RAZORPAY_KEY_SECRET");
    expect(source).not.toContain("new Razorpay({");
    expect(source).toContain('verifyRes.data.status === "VERIFIED"');
  });

  it("3. razorpay helper locks amount and order_id as readonly in source", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/razorpay.ts"),
      "utf8",
    );
    expect(source).toContain("readonly:");
    expect(source).toContain("amount: true");
    expect(source).toContain("order_id: true");
  });

  it("4. failed verification path does not set verified UI state in source", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/CheckoutPaymentPanel.tsx"),
      "utf8",
    );
    expect(source).toContain('setPaymentState("failed")');
    expect(source).toMatch(
      /if \(verifyRes\.data\.status === "VERIFIED"\)[\s\S]*setPaymentState\("verified"\)/,
    );
  });
});
