/**
 * Hosted-Supabase E2E: Phase 6 agent → materialize → Phase 7 select → quote → policy.
 *
 * REQUIRES hosted project ccrlaeiwxeyqmakttrsw via SUPABASE_URL / SERVICE_ROLE_KEY.
 * Does NOT use Docker/local Postgres. Skips (reports NOT VERIFIED) if target mismatches.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { loadEnv, getEnv, isSupabaseConfigured } from "../../src/config/env.js";
import { getSupabaseClient, resetSupabaseClient } from "../../src/config/supabase.js";
import { SessionsRepository } from "../../src/modules/sessions/repository.js";
import { AgentService } from "../../src/modules/agent/index.js";
import { DeterministicRequirementExtractor } from "../../src/modules/requirements/deterministic-extractor.js";
import {
  type BestValueInput,
  type OptimizationCandidate,
  type PackCandidateInput,
  type PackQualitySnapshot,
} from "../../src/modules/optimization/index.js";
import {
  SEED_PRODUCT_IDS,
  SEED_SKU_IDS,
  SIX_EGG_SCENARIO,
} from "../../src/modules/research/seed-fixtures.js";
import { createApp } from "../../src/app.js";

const HOSTED_REF = "ccrlaeiwxeyqmakttrsw";
const USER_A = "44444444-4444-4444-8444-444444444401";
const USER_B = "44444444-4444-4444-8444-444444444402";
const MANDATE_A = "77777777-7777-4777-8777-777777777701";

/** Reload repo .env so sibling tests cannot poison hosted credentials. */
function restoreHostedEnvFromDotenv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: true, quiet: true });
      break;
    }
  }
  loadEnv({
    NODE_ENV: "test",
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
  });
  resetSupabaseClient();
}

restoreHostedEnvFromDotenv();

function isHostedTarget(): boolean {
  const env = getEnv();
  if (!isSupabaseConfigured(env)) {
    return false;
  }
  try {
    const host = new URL(env.SUPABASE_URL).hostname;
    return host.startsWith(`${HOSTED_REF}.`);
  } catch {
    return false;
  }
}

const hostedReady = isHostedTarget();

function signToken(userId: string): string {
  const secret = getEnv().JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET required for hosted seam test");
  }
  return jwt.sign({ sub: userId }, secret, { expiresIn: "1h" });
}

function quality(
  signal: PackQualitySnapshot["quality_signal"],
): PackQualitySnapshot {
  return {
    quality_signal: signal,
    confidence: 0.9,
    evidence_refs: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02"],
    evidence_status: signal === null ? "NONE" : "SUFFICIENT",
    meets_minimum_quality:
      signal === null ? false : signal !== "UNACCEPTABLE",
  };
}

function candidate(
  overrides: Partial<OptimizationCandidate> &
    Pick<
      OptimizationCandidate,
      "product_id" | "sku_id" | "product_name" | "sku_code"
    >,
): OptimizationCandidate {
  return {
    brand: null,
    category_code: "dairy",
    product_status: "ACTIVE",
    sku_status: "ACTIVE",
    pack_quantity: 6,
    pack_unit: "pieces",
    price_minor: 3600,
    currency: "INR",
    stock_available: 24,
    ...overrides,
  };
}

function eggsOptimizationInput(): BestValueInput {
  const packs: PackCandidateInput[] = [
    {
      candidate: candidate({
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_id: SEED_SKU_IDS.farmEggs6,
        product_name: "Farm Eggs 6",
        sku_code: SIX_EGG_SCENARIO.poorSixPack.sku_code,
        pack_quantity: 6,
        price_minor: SIX_EGG_SCENARIO.poorSixPack.price_minor,
      }),
      quality: quality("UNACCEPTABLE"),
    },
    {
      candidate: candidate({
        product_id: SEED_PRODUCT_IDS.selectEggs,
        sku_id: SEED_SKU_IDS.selectEggs6,
        product_name: "Select Eggs 6",
        sku_code: SIX_EGG_SCENARIO.goodSixPack.sku_code,
        pack_quantity: 6,
        price_minor: SIX_EGG_SCENARIO.goodSixPack.price_minor,
      }),
      quality: quality("GOOD"),
    },
    {
      candidate: candidate({
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_id: SEED_SKU_IDS.farmEggs2,
        product_name: "Farm Eggs 2",
        sku_code: SIX_EGG_SCENARIO.goodTwoPack.sku_code,
        pack_quantity: 2,
        price_minor: SIX_EGG_SCENARIO.goodTwoPack.price_minor,
      }),
      quality: quality("GOOD"),
    },
  ];

  return {
    requirements: [
      {
        requirement: {
          item_name: "eggs",
          target_quantity: 6,
          unit: "pieces",
          minimum_quality: "ACCEPTABLE",
          constraints_json: [],
        },
        pack_candidates: packs,
      },
    ],
    budget_minor: 100_000,
  };
}


/**
 * Minimal hosted fixtures for seam E2E (schema already applied; seed was empty).
 * Upserts only — no DDL / no schema changes.
 */
async function ensureHostedSeamFixtures(): Promise<void> {
  const db = getSupabaseClient();

  const { error: catErr } = await db.from("category").upsert(
    [
      {
        category_id: "11111111-1111-4111-8111-111111111101",
        code: "dairy",
        name: "Dairy",
      },
      {
        category_id: "11111111-1111-4111-8111-111111111105",
        code: "grocery",
        name: "Grocery",
      },
    ],
    { onConflict: "category_id" },
  );
  if (catErr) throw catErr;

  const { error: prodErr } = await db.from("product").upsert(
    [
      {
        product_id: SEED_PRODUCT_IDS.farmEggs,
        name: "Farm Eggs",
        description: "Fresh farm eggs",
        category_id: "11111111-1111-4111-8111-111111111101",
        brand: "FarmFresh",
        status: "ACTIVE",
      },
      {
        product_id: SEED_PRODUCT_IDS.selectEggs,
        name: "Select Eggs",
        description: "Higher-grade eggs",
        category_id: "11111111-1111-4111-8111-111111111101",
        brand: "SelectFarm",
        status: "ACTIVE",
      },
    ],
    { onConflict: "product_id" },
  );
  if (prodErr) throw prodErr;

  const { error: skuErr } = await db.from("sku").upsert(
    [
      {
        sku_id: SEED_SKU_IDS.farmEggs2,
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_code: "FARM-EGGS-2",
        pack_quantity: 2,
        pack_unit: "pieces",
        price_minor: 1200,
        currency: "INR",
        status: "ACTIVE",
      },
      {
        sku_id: SEED_SKU_IDS.farmEggs6,
        product_id: SEED_PRODUCT_IDS.farmEggs,
        sku_code: "FARM-EGGS-6",
        pack_quantity: 6,
        pack_unit: "pieces",
        price_minor: 3600,
        currency: "INR",
        status: "ACTIVE",
      },
      {
        sku_id: SEED_SKU_IDS.selectEggs6,
        product_id: SEED_PRODUCT_IDS.selectEggs,
        sku_code: "SELECT-EGGS-6",
        pack_quantity: 6,
        pack_unit: "pieces",
        price_minor: 4200,
        currency: "INR",
        status: "ACTIVE",
      },
    ],
    { onConflict: "sku_id" },
  );
  if (skuErr) throw skuErr;

  const { error: stockErr } = await db.from("stock").upsert(
    [
      { sku_id: SEED_SKU_IDS.farmEggs2, available_quantity: 48 },
      { sku_id: SEED_SKU_IDS.farmEggs6, available_quantity: 24 },
      { sku_id: SEED_SKU_IDS.selectEggs6, available_quantity: 30 },
    ],
    { onConflict: "sku_id" },
  );
  if (stockErr) throw stockErr;

  const { error: userErr } = await db.from("app_user").upsert(
    [
      { user_id: USER_A, display_name: "Demo Shopper", currency: "INR" },
      { user_id: USER_B, display_name: "Second Shopper", currency: "INR" },
    ],
    { onConflict: "user_id" },
  );
  if (userErr) throw userErr;

  const { error: mandateErr } = await db.from("mandate").upsert(
    {
      mandate_id: MANDATE_A,
      user_id: USER_A,
      agent_id: "agent-001",
      max_spend_minor: 100000,
      currency: "INR",
      max_per_item_minor: 30000,
      purpose: "Mandate A — seam fixture",
      valid_until: "2026-12-31T23:59:59+00:00",
      status: "ACTIVE",
      created_at: "2026-09-01T00:00:00+00:00",
    },
    { onConflict: "mandate_id" },
  );
  if (mandateErr) throw mandateErr;

  const { error: mcErr } = await db.from("mandate_category").upsert(
    [
      { mandate_id: MANDATE_A, category: "grocery" },
      { mandate_id: MANDATE_A, category: "dairy" },
    ],
    { onConflict: "mandate_id,category" },
  );
  if (mcErr) throw mcErr;
}

describe.skipIf(!hostedReady)(
  "Hosted Supabase — Phase 6→7 agent materialize → select → quote → policy",
  () => {
    let sessionId: string;
    let app: ReturnType<typeof createApp>;

    beforeAll(async () => {
      restoreHostedEnvFromDotenv();
      await ensureHostedSeamFixtures();
      const sessions = new SessionsRepository();
      const session = await sessions.insert({
        user_id: USER_A,
        status: "ACTIVE",
      });
      sessionId = session.session_id;
      app = createApp();
    });

    afterAll(() => {
      resetSupabaseClient();
    });

    it("proves agent materializes UUID baskets then selection/quote/policy on hosted DB", async () => {
      expect(getEnv().SUPABASE_URL).toContain(HOSTED_REF);

      const agent = new AgentService({
        extractor: new DeterministicRequirementExtractor(),
        useStubLlm: true,
      });

      const plan = await agent.runPlanning({
        agent_run_id: randomUUID(),
        request_id: `hosted-seam-${Date.now()}`,
        user_id: USER_A,
        session_id: sessionId,
        mandate: {
          mandate_id: MANDATE_A,
          max_spend_minor: 100_000,
          max_per_item_minor: 30_000,
          allowed_categories: ["grocery", "dairy"],
          currency: "INR",
        },
        goal: { goal_text: "6 eggs" },
        require_policy_check: false,
        skip_catalog_research: true,
        optimization_input: eggsOptimizationInput(),
      });

      expect(plan.outcome).toBe("COMPLETED");
      expect(plan.run.persisted_baskets).not.toBeNull();
      expect(plan.run.persisted_baskets?.optimization_run_id).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      expect(plan.run.persisted_baskets?.best_value?.basket_id).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      expect(plan.run.persisted_baskets?.best_quality?.basket_id).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      expect(plan.run.persisted_baskets?.best_value?.source_basket_key).toMatch(
        /^BEST_VALUE:/,
      );
      expect(
        plan.run.persisted_baskets?.best_quality?.source_basket_key,
      ).toMatch(/^BEST_QUALITY:/);

      const bvId = plan.run.persisted_baskets!.best_value!.basket_id;
      const bqId = plan.run.persisted_baskets!.best_quality!.basket_id;
      expect(bvId).not.toBe(bqId);
      expect(plan.run.policy).toBeNull();

      const list = await request(app)
        .get(`/api/v1/sessions/${sessionId}/baskets`)
        .set("Authorization", `Bearer ${signToken(USER_A)}`);
      expect(list.status).toBe(200);
      expect(list.body.data.best_value.basket_id).toBe(bvId);
      expect(list.body.data.best_quality.basket_id).toBe(bqId);
      expect(list.body.data.recommendation.user_may_select_alternative).toBe(
        true,
      );

      const crossList = await request(app)
        .get(`/api/v1/sessions/${sessionId}/baskets`)
        .set("Authorization", `Bearer ${signToken(USER_B)}`);
      expect(crossList.status).toBe(403);

      const selectValue = await request(app)
        .post(`/api/v1/sessions/${sessionId}/basket-selections`)
        .set("Authorization", `Bearer ${signToken(USER_A)}`)
        .send({ basket_id: bvId, selection_source: "USER" });
      expect(selectValue.status).toBe(201);
      expect(selectValue.body.data.order_created).toBe(false);
      expect(selectValue.body.data.payment_created).toBe(false);
      expect(selectValue.body.data.policy_decision).toBeNull();

      const selectQuality = await request(app)
        .post(`/api/v1/sessions/${sessionId}/basket-selections`)
        .set("Authorization", `Bearer ${signToken(USER_A)}`)
        .send({ basket_id: bqId, selection_source: "USER" });
      expect(selectQuality.status).toBe(201);
      expect(selectQuality.body.data.basket_id).toBe(bqId);

      const quoteRes = await request(app)
        .post(`/api/v1/baskets/${bqId}/quote`)
        .set("Authorization", `Bearer ${signToken(USER_A)}`)
        .send({
          client_claims: { final_payable_minor: 1 },
        });
      expect(quoteRes.status).toBe(201);
      expect(quoteRes.body.data.amount_kind).toBe("AUTHORITATIVE_QUOTE");
      expect(quoteRes.body.data.final_payable_minor).toBeGreaterThan(1);
      expect(quoteRes.body.data.order_created).toBe(false);
      expect(quoteRes.body.data.payment_created).toBe(false);
      expect(quoteRes.body.data.policy_decision).toBeNull();

      const quoteVersion = quoteRes.body.data.quote_version as string;

      const policyRes = await request(app)
        .post("/api/v1/policy/evaluate")
        .set("Authorization", `Bearer ${signToken(USER_A)}`)
        .set("Idempotency-Key", `hosted-seam-${randomUUID()}`)
        .send({
          mandate_id: MANDATE_A,
          basket_id: bqId,
          quote_version: quoteVersion,
        });

      expect([200, 422]).toContain(policyRes.status);
      if (policyRes.status === 200) {
        expect(policyRes.body.data.decision).toBe("ALLOW");
      } else {
        expect(policyRes.body.error.code).toBeTruthy();
      }

      expect(JSON.stringify(policyRes.body)).not.toMatch(/razorpay/i);
    }, 120_000);
  },
);

describe("Hosted seam gate", () => {
  it("documents hosted target requirement", () => {
    if (!hostedReady) {
      expect(hostedReady).toBe(false);
      return;
    }
    expect(getEnv().SUPABASE_URL).toContain(HOSTED_REF);
  });
});
