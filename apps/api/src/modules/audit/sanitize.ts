const FORBIDDEN_AUDIT_KEYS = new Set([
  "razorpay_signature",
  "signature",
  "key_secret",
  "webhook_secret",
  "razorpay_key_secret",
  "razorpay_webhook_secret",
  "authorization",
  "password",
  "token",
]);

const FORBIDDEN_KEY_PATTERN =
  /(secret|signature|password|token|authorization|api[_-]?key|webhook)/i;

/**
 * Strip sensitive payment verification fields before audit persistence.
 * Doc 09 operational logging rules — no secrets or signatures in audit payloads.
 */
export function sanitizeAuditEventData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = key.toLowerCase();
    if (
      FORBIDDEN_AUDIT_KEYS.has(normalizedKey) ||
      FORBIDDEN_KEY_PATTERN.test(key)
    ) {
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditEventData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
