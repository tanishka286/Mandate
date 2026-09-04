# Mandate Architecture

## Core invariant

```
AI reasons.
User chooses.
Backend validates.
Policy authorizes.
Razorpay executes.
Audit records.
```

The AI/LLM is **never** the financial authority.

## System shape

Mandate is a **modular monolith**:

- `apps/web` - Next.js UI (untrusted client)
- `apps/api` - Express TypeScript API (authorization + commerce boundary)
- `packages/*` - shared types and config
- `supabase/` - PostgreSQL schema via SQL migrations

### Request path

```
Route -> Controller -> Service -> Repository -> Supabase
```

Controllers must not contain direct database logic.

### AI path (future phases)

```
User / session
  -> Backend agent orchestration
    -> Ollama (qwen3:14b) for reasoning only
    -> Explicit tool adapters (backend-owned)
      -> Domain services
        -> Repositories -> Supabase
```

The AI agent must **not**:

- connect to Supabase
- receive database credentials
- modify mandates / max_spend / categories
- create Razorpay orders
- mark payments successful
- bypass policy denial

## API contract

**Success**

```json
{
  "data": {},
  "meta": { "request_id": "req-001" }
}
```

**Error**

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Safe client-facing message",
    "details": {},
    "request_id": "req-001"
  }
}
```

Never return stack traces, secrets, or privileged internals.

## Correlation and idempotency

- `X-Request-ID` - generated or accepted; flows through logs and errors
- `Idempotency-Key` - captured in Phase 0; full financial idempotency in later phases

## Money

Authoritative amounts are **integer minor units** (paise for INR).
INR 874 = `87400`. No floating-point for financial authority.

## Phase 0 scope

Foundation only: structure, health endpoint, middleware, logging, auth stubs, Supabase client, Ollama client stub, CI. No commerce features.
