import { createHash } from "node:crypto";

/**
 * Input for authoritative checkout request fingerprint.
 *
 * All fields represent server-authoritative state:
 * - selection_id: user-selected basket proposal
 * - policy_decision_id: ALLOW policy authorization
 * - quote_version: fresh quote version matching the selection
 * - final_payable_minor: server-resolved authoritative amount in INR paise
 *
 * The browser/AI must never be treated as authoritative for the amount.
 */
export interface CheckoutFingerprintInput {
  selection_id: string;
  policy_decision_id: string;
  quote_version: string;
  final_payable_minor: number;
}

/**
 * Deterministic SHA-256 fingerprint for checkout / payment-attempt idempotency.
 * Canonical sorted JSON keys -> SHA-256 hex string.
 * Scope (user_id) is NOT included in the fingerprint itself — user_id forms the uniqueness namespace.
 */
export function buildCheckoutFingerprint(
  input: CheckoutFingerprintInput,
): string {
  const canonical = JSON.stringify({
    final_payable_minor: input.final_payable_minor,
    policy_decision_id: input.policy_decision_id,
    quote_version: input.quote_version,
    selection_id: input.selection_id,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
