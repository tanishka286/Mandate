# Mandate Documentation

## 1. What Mandate is

Mandate is an **AI-native grocery commerce system**. The product flow is:

1. AI reasons about goals, requirements, research, and recommendations
2. User chooses among presented options
3. Backend validates all inputs
4. Deterministic policy authorizes (or denies)
5. Razorpay executes payment (test mode in early phases)
6. Audit records the financial and authorization trail

The AI/LLM is **never** the financial authority.

## 2. Architecture

Modular monolith:

```
Next.js (apps/web)
    -> HTTP /api/v1
Express API (apps/api)
    -> Domain Services
Repositories
    -> @supabase/supabase-js (service role)
Supabase PostgreSQL
```

See [architecture.md](./architecture.md).

## 3. Repository structure

```
mandate/
├── apps/web          # Next.js frontend foundation
├── apps/api          # Express backend (domain modules + AI adapters)
├── packages/types    # Shared API contract types
├── packages/config   # Shared non-secret constants
├── packages/eslint-config
├── supabase/         # Migrations, seed, CLI config
├── docs/
├── scripts/
├── tests/
└── .github/workflows/
```

## 4. Frontend / backend relationship

- Local frontend: `http://localhost:3000`
- Local API: `http://localhost:4000/api/v1`
- The frontend must **not** connect directly to Supabase for authoritative commerce data
- The frontend must **not** hold `SUPABASE_SERVICE_ROLE_KEY`

## 5. Supabase database architecture

```
Supabase -> PostgreSQL -> Supabase JS client -> Mandate Backend -> Domain Services
```

Details: [database.md](./database.md).

## 6. How Supabase credentials are configured

Copy `.env.example` -> `.env` (never commit `.env`):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Loaded only by `apps/api` via `src/config/env.ts` and `src/config/supabase.ts`.

## 7. How Ollama / qwen3:14b will eventually integrate

- Client abstraction: `apps/api/src/ai/ollama/`
- Env: `OLLAMA_BASE_URL` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `qwen3:14b`)
- Phase 0 only establishes the client - **no** agent orchestration, prompts, or tools yet
- Future AI must use explicit backend tool adapters and must never receive DB credentials

## 8. Development commands

```bash
npm install
npm run dev:api
npm run dev:web
npm run lint
npm run typecheck
npm run test
npm run build

npm run supabase:start
npm run supabase:stop
npm run supabase:status
npm run supabase:db:push
npm run supabase:db:reset
```

Do **not** run destructive `db reset` casually against shared environments.

## 9. Trust boundaries

| Actor | Trusted for finance? |
|-------|----------------------|
| LLM output | No |
| Frontend / browser | No |
| Client-provided totals | No |
| Backend validation + policy | Yes (authorization) |
| Razorpay (server-confirmed) | Execution only after ALLOW |
| Audit trail | Record of truth |

## 10. Security rules (invariants)

1. LLM output is untrusted
2. Frontend values are untrusted
3. Client-provided totals are never authoritative
4. AI cannot authorize payments
5. AI cannot modify mandates
6. AI cannot set authoritative prices
7. AI cannot declare stock available
8. AI cannot calculate authoritative final payable
9. No Razorpay order before deterministic policy ALLOW
10. Payment success must be server-confirmed
11. Webhooks must be signature-validated and idempotent
12. Financial values use integer minor units (paise)
13. Secrets must never be committed
14. Product/review text is untrusted input
15. Fail closed when authorization is uncertain
16. Supabase service-role credentials stay server-side
17. Frontend is never an authority for financial state

## Roadmap

| Phase | Focus |
|-------|--------|
| 0 | Project foundation (current) |
| 1 | Commerce core |
| 2 | Mandate + policy |
| 3 | Shopping intent |
| 4 | Research + quality |
| 5 | Optimization + incentives |
| 6 | AI agent orchestration |
| 7 | User selection + fresh quote |
| 8 | Razorpay test mode |
| 9 | Audit + observability |
| 10 | Hardening + demo freeze |
