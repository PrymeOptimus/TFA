# Architecture (Milestone 1)

TypeScript modular monolith + separate worker process, one PostgreSQL database.

```
Browser ──► Next.js 16 (App Router)
             ├─ pages + server actions ─┐
             ├─ /api/v1/* route handlers ┼─► src/server/services/*  ──► PostgreSQL 16
             └─ /api/public/forms/:token ┘        (business rules)        (role crm_app, RLS)
Worker (src/worker/main.ts) ─► engine: claim runs/outbox (SECURITY DEFINER) ─► services/engine
                                └─► MessagingProvider (LocalSimulatedProvider in M1)
```

## Stack (versions pinned in pnpm-lock.yaml, verified on npm 2026-10-21)
next 16.4.2 · react 19.3.1 · drizzle-orm 0.45.4 / drizzle-kit 0.31.11 · pg 8.23.1 ·
better-auth 1.7.12 (scrypt, DB sessions, twoFactor TOTP + backup codes) · zod 4.6.7 ·
libphonenumber-js 1.13.15 · pino 10.4.0 · @opentelemetry/api 1.10.0 · tailwindcss 4.3.3 ·
TypeScript 6.0.3 (chose 6.x over 7.0 native port for tool compatibility) · vitest 5.0.5 ·
@playwright/test 1.56.1 (matches the Chromium build available in this environment).

**Documentation verification limits:** this session's network policy blocked vendor documentation
sites (nextjs.org, better-auth.com, orm.drizzle.team, postgresql.org). Versions were verified
against the npm registry, and APIs against the installed packages' published type declarations
(e.g. Better Auth `getAuthTables`, two-factor and Next.js integration types). Re-check vendor docs
before Milestone 2.

## Layers
- **Services** (`src/server/services`) own all business rules and authorization. UI server
  actions, API routes and the worker call the same functions; nothing is duplicated in the UI.
- **Tenant context**: `withTenant(tenantId, userId, fn)` opens a transaction and binds
  `app.tenant_id`/`app.user_id` with `set_config(..., true)` (transaction-local, pool-safe).
- **Actor**: derived from the Better Auth session + a verified membership. A tenant cookie is only a
  preference among the user's memberships.
- **Engine** (`src/server/engine/engine.ts`): see DECISIONS ADR-002.
- **Observability**: pino structured logs with redaction (contact details, bodies, credentials);
  correlation ids on requests, runs and audit events; OpenTelemetry API spans around step execution
  (no SDK registered yet → no-op).

## Durable execution summary
| Concern | Mechanism |
| --- | --- |
| Persistence | `workflow_run` row: current step, context, status, `wake_at`, lease |
| Timers | `wake_at` column; claimable when `wake_at <= now` |
| Concurrency | `engine_claim_runs` / `engine_claim_outbox`: `FOR UPDATE SKIP LOCKED` + lease expiry |
| Worker crash | Lease expires (default 30 s); another worker resumes from persisted step |
| Effect atomicity | Step business write + `step_effect` + `step_attempt` in one transaction |
| External effects | Transactional outbox; provider idempotency key `run:<id>:step:<id>` |
| Ambiguity | Interrupted dispatch + non-idempotent provider ⇒ `unknown`, run `needs_review` |
| Retries | Outbox: 4 attempts, exponential backoff 2 s→5 min cap, ±20 % jitter; steps: 3 attempts |
| Version pinning | `workflow_run.workflow_version_id` set at creation; trigger blocks changes |
| Pause | Paused workflows are not claimed; dispatcher defers sends (also tenant kill switch) |
| Test clock | Engine takes `now()`; claims pass `p_now` |

## Local vs. production
- Local: Docker Compose PostgreSQL, `pnpm dev`, `pnpm worker`, local simulation adapter.
- `APP_ENV=production` rejects `MESSAGING_PROVIDER=local` and `CRM_FAULT` at startup.
- No production deployment plan is claimed in M1. Required before any pilot: managed PostgreSQL
  with PITR, secrets manager, TLS, shared rate-limit store, monitored worker, real providers.
