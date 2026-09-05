/**
 * Deterministic Phase 10 incentive seed fixtures (mirrors supabase/seed.sql).
 * Used for reproducible unit/integration assertions — not an alternate seed path.
 */

export const SEED_INCENTIVE_IDS = {
  VALID_MEANINGFUL_VOUCHER: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
  LOW_CURRENT_HIGH_FUTURE_VOUCHER: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02",
  EXPIRED_VOUCHER: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03",
  MINIMUM_SPEND_VOUCHER: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04",
  USABLE_LOYALTY_REWARD: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab01",
  PRESERVE_LOYALTY_REWARD: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab02",
} as const;

export const SEED_INCENTIVE_FIXTURE_CODES = {
  VALID_MEANINGFUL_VOUCHER: "VALID_MEANINGFUL_VOUCHER",
  LOW_CURRENT_HIGH_FUTURE_VOUCHER: "LOW_CURRENT_HIGH_FUTURE_VOUCHER",
  EXPIRED_VOUCHER: "EXPIRED_VOUCHER",
  MINIMUM_SPEND_VOUCHER: "MINIMUM_SPEND_VOUCHER",
  USABLE_LOYALTY_REWARD: "USABLE_LOYALTY_REWARD",
  PRESERVE_LOYALTY_REWARD: "PRESERVE_LOYALTY_REWARD",
} as const;
