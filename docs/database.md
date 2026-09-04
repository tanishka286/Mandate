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
- Full commerce entities arrive incrementally in later phases

## Seed data

- File: `supabase/seed.sql`
- Phase 0: minimal metadata only - no grocery catalogs

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
