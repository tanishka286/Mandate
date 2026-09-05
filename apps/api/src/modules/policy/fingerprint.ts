import { createHash } from "node:crypto";

/**
 * Deterministic fingerprint for policy evaluate idempotency (Doc 08 body).
 * Canonical JSON with sorted keys → SHA-256 hex.
 * Scope (user_id) is NOT included — it is the uniqueness namespace.
 */
export function buildPolicyRequestFingerprint(input: {
  mandate_id: string;
  basket_id: string;
  quote_version: string;
}): string {
  const canonical = JSON.stringify({
    basket_id: input.basket_id,
    mandate_id: input.mandate_id,
    quote_version: input.quote_version,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
