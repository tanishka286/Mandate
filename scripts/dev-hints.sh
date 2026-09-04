#!/usr/bin/env bash
# Helper: print Phase 0 local development tips.
set -euo pipefail

cat <<'EOF'
Mandate Phase 0 - local development

1. cp .env.example .env
2. Fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET (server only)
3. npm install
4. npm run dev:api   # http://localhost:4000
5. npm run dev:web   # http://localhost:3000

Supabase (optional local CLI):
  npm run supabase:start
  npm run supabase:status
  npm run supabase:db:push

Health:
  curl -s http://localhost:4000/api/v1/health | jq
EOF
