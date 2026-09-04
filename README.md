# Mandate

AI-native grocery commerce system.

**AI reasons -> User chooses -> Backend validates -> Deterministic policy authorizes -> Razorpay executes -> Audit records**

The AI/LLM is **never** the financial authority.

## Phase 0 - Project Foundation

This repository currently contains the development foundation only:

- npm workspaces monorepo (`apps/web`, `apps/api`, shared packages)
- Next.js + TypeScript + Tailwind frontend scaffold
- Express + TypeScript backend scaffold
- Supabase (PostgreSQL) configuration and server-side client
- Health endpoint, request IDs, error handling, logging
- Auth / idempotency / Ollama client foundations
- Vitest, ESLint, GitHub Actions CI

Business features (catalog, agent, payments, optimization, UI screens) are intentionally **not** implemented yet.

## Quick start

```bash
cp .env.example .env
# Fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET (server-only)

npm install

# Terminal 1 - API (port 4000)
npm run dev:api

# Terminal 2 - Web (port 3000)
npm run dev:web
```

Health check: `GET http://localhost:4000/api/v1/health`

## Documentation

See [docs/README.md](./docs/README.md) for architecture, trust boundaries, and security rules.
