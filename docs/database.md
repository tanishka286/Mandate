# Mandate Database

## Platform

**Supabase** hosts **PostgreSQL**. Access from the Mandate backend uses **`@supabase/supabase-js`**.

Do **not** use MongoDB, Prisma, Drizzle, Sequelize, TypeORM, local Docker PostgreSQL, or direct frontend DB access.

## Access model

```
Supabase
  -> PostgreSQL
    -> Supabase JS client (apps/api/src/config/supabase.ts)
      -> Mandate Backend
        -> Domain Services / Repositories
```

| Layer | May access Supabase? |
|-------|----------------------|
| Express API (service role) | Yes - only application layer for authoritative commerce data |
| Next.js frontend | **No** |
| Ollama / AI agent | **No** |
| Browser | **No** |

## Credentials

Environment variables (server only):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

- Defined in `.env.example` (empty placeholders)
- Loaded by `apps/api/src/config/env.ts`
- Instantiated once in `apps/api/src/config/supabase.ts`
- **Never** expose `SUPABASE_SERVICE_ROLE_KEY` to Next.js, browser, Ollama, prompts, logs, or git

## Migrations

- Location: `supabase/migrations/`
- Tooling: Supabase SQL migrations (no ORM migrations)
- Phase 0: minimal `schema_meta` table + `pgcrypto` only
- Phase 1 Step 1: `category` table (controlled codes)
- Phase 1 Step 2: `product` table (catalog identity; FK to category; no price/stock)
- Phase 1 Step 3: `sku` table (pack variant + authoritative `price_minor`; FK to product)
- Phase 1 Step 4: `stock` table (inventory availability per SKU; FK/PK to sku)
- Phase 1 Step 5: catalog search over existing tables (no schema change)
- Phase 1 Step 6: `app_user` + `cart` (ownership/lifecycle; no cart items)
- Phase 1 Step 7: `cart_item` (Cart → SKU → quantity; no prices/totals)
- Phase 1 Step 8: cart pricing calculated dynamically from `cart_item.quantity` × current `sku.price_minor` (no persisted totals)
- Phase 1 Step 9: application order state = `cart.status` (`OPEN_CART` | `CANCELLED`); payment order states deferred to Phase 8
- Phase 2 Step 1: `mandate` + `mandate_category` (authorization constraints; FK to `app_user`; no policy evaluation yet)
- Phase 2 Step 3: `policy_decision` (historical ALLOW|DENY; `basket_id` UUID NOT NULL with FK deferred until real `basket`)
- Phase 2 Step 4: deterministic policy evaluation service (Doc 06 order); no new migration; payment gate deferred
- Phase 7: `optimization_run` (minimal), `basket`, `basket_item`, `basket_selection`, `basket_quote` (user selection + fresh quote versioning; no orders/payments)
- Incentive discounts and remaining commerce entities arrive in later phases

## Seed data

- File: `supabase/seed.sql`
- Phase 1 Step 1: seeded MVP categories (`dairy`, `pantry`, `produce`, `beverages`, `household`)
- Phase 1 Step 2: seeded grocery products (eggs, pasta, pasta sauce, milk, bread)
- Phase 1 Step 3: seeded SKU packs with deterministic INR `price_minor` values
- Phase 1 Step 4: seeded stock quantities (includes deliberate out-of-stock SKU)
- Phase 1 Step 5: search uses seeded catalog rows (no additional seed entities)
- Phase 1 Step 6: seeded `app_user` + open carts (no cart items)
- Phase 1 Step 7: cart items are created via API (no seed cart lines)
- Phase 2 Step 1: seeded Mandates A/B/C (Doc 10) with `grocery` allow-list categories
- Phase 2 Step 3: no policy_decision seed rows (historical facts are written by the engine later)

## Security

- Supabase PostgreSQL is authoritative for persisted commerce state
- Backend remains the main authorization boundary
- RLS may be enabled on tables; complex RLS is **not** required before domain schema exists
- Authentication is not mandate authorization (policy is deterministic backend logic)

## Principles

- Relational tables + foreign keys for critical commerce state
- JSON/JSONB only where flexible AI metadata is appropriate - not as a substitute for ownership
- Money in integer minor units (paise)
- Timestamps in UTC
- Controlled status enums where appropriate
- Critical transitions validated by backend logic
- AI-generated fields are never authoritative merely because they are persisted

## Why frontend cannot access authoritative commerce data

The browser is untrusted. Client-provided totals, prices, and stock claims must never become financial truth. All reads/writes of commerce state go through the Express API.

## Why AI cannot access the database

The LLM is untrusted. Giving it SQL, Supabase credentials, or direct write paths would let non-deterministic output become financial authority. AI must operate only through backend tool adapters that enforce validation and policy.
