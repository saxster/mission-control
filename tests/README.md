# E2E Tests

Playwright end-to-end specs for Mission Control API and UI.

## Running

```bash
# Start the dev server first (or let Playwright auto-start via reuseExistingServer)
pnpm dev --hostname 127.0.0.1 --port 3005

# Run all tests
pnpm test:e2e

# Run the focused Hermes vitest bundle
pnpm test:hermes

# Run the paired Hermes verification path (unit bundle + operator-path browser regression)
pnpm test:hermes:full

# Run the Mission Control fixture harness (no live gateway install required)
pnpm test:e2e:harness

# Run a specific spec
pnpm exec playwright test tests/tasks-crud.spec.ts
```

## Test Environment

Tests require `.env.local` with:
- `API_KEY=test-api-key-e2e-12345`
- `MC_DISABLE_RATE_LIMIT=1` (bypasses mutation/read rate limits, keeps login rate limit active)

## Mission Control Fixture Harness

The harness runs Mission Control against fixture data and mock binaries/gateway.
The mocked runtime still uses `openclaw.json` and `OPENCLAW_*` compatibility env vars because those are current runtime contracts.
- fixtures: `tests/fixtures/runtime-home/`
- mock CLI: `scripts/e2e-harness/bin/{openclaw,clawdbot}`
- mock gateway: `scripts/e2e-harness/mock-gateway.mjs`

Profiles:
- `pnpm test:e2e:harness:local` - local mode (gateway not running)
- `pnpm test:e2e:harness:gateway` - gateway mode (mock gateway running)

## Spec Files

### Security & Auth
- `auth-guards.spec.ts` — All API routes return 401 without auth
- `csrf-validation.spec.ts` — CSRF origin header validation
- `legacy-cookie-removed.spec.ts` — Old cookie format rejected
- `login-flow.spec.ts` — Login, session, redirect lifecycle
- `rate-limiting.spec.ts` — Login brute-force protection
- `timing-safe-auth.spec.ts` — Constant-time API key comparison

### CRUD Lifecycle
- `tasks-crud.spec.ts` — Tasks POST/GET/PUT/DELETE with filters, Aegis gate
- `agents-crud.spec.ts` — Agents CRUD, lookup by name/id, admin-only delete
- `task-comments.spec.ts` — Threaded comments on tasks
- `workflows-crud.spec.ts` — Workflow template CRUD
- `webhooks-crud.spec.ts` — Webhooks with secret masking and regeneration
- `alerts-crud.spec.ts` — Alert rule CRUD with full lifecycle
- `user-management.spec.ts` — User admin CRUD

### Features
- `notifications.spec.ts` — Notification delivery and read tracking
- `quality-review.spec.ts` — Quality reviews with batch lookup
- `search-and-export.spec.ts` — Global search, data export, activity feed

### Hermes Focused Unit Bundle
- `pnpm test:hermes` — Hermes bootstrap, routing, tasks, event ingestion, session continuation, and client-side route-binding sync
- `pnpm test:hermes:full` — The Hermes unit bundle plus the `tests/hermes-operator-path.spec.ts` browser regression

### Infrastructure
- `limit-caps.spec.ts` — Endpoint limit caps enforced
- `delete-body.spec.ts` — DELETE body standardization

### Shared
- `helpers.ts` — Factory functions (`createTestTask`, `createTestAgent`, etc.) and cleanup helpers
