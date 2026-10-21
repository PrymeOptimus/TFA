# Architecture decisions

## ADR-001 Stack: TypeScript modular monolith (Next.js) + worker + PostgreSQL
Empty repository, so the spec's default applies. One deployable web app, one worker process, one
database. No microservices, queues, caches or search clusters until a present requirement exists.

## ADR-002 Durable workflow runtime: PostgreSQL-backed engine, not Temporal (for now)
**Context.** The spec prefers Temporal and asks for an evaluation of its overhead.
**Temporal costs here:** a separate cluster (frontend/history/matching services + its own
persistence) or a paid Temporal Cloud account; another system to secure, back up, upgrade and
monitor; workflow state split between Temporal history and our database, so every step's business
write would still need its own idempotency because Temporal activities and our DB transaction
cannot commit atomically; the dev server is not a production plan.
**Decision.** Implement a small durable engine on the authoritative PostgreSQL database:
- *Persistence:* run state, current step and context are rows; definitions are immutable
  versions interpreted at run time (versions are data, not code, so there is no code-versioning
  replay problem).
- *Timers:* `wake_at` column; nothing is held in memory (A3 lets the timer elapse with no worker).
- *Retries:* bounded attempts with exponential backoff + jitter (steps 3, outbox 4), then a
  failed-action review queue with audited retry/skip.
- *Worker crashes:* time-bounded leases claimed via `FOR UPDATE SKIP LOCKED`; expired leases are
  reclaimed. Each step's business write and its `step_effect` row commit atomically (A3 kills a
  worker before commit and after provider acceptance).
- *Version pinning:* run row references one `workflow_version`; DB trigger forbids changing it.
**Consequences.** Fewer services and true transactional coupling with business data. We own the
engine's correctness (covered by A2–A5). Throughput is bounded by PostgreSQL polling (fine for the
pilot; measure before scaling). Revisit Temporal if we need long-running fan-out, cross-service
sagas or very high volume; the `StepOutcome`/handler boundary keeps that migration contained.

## ADR-003 Authentication: Better Auth
Mature library with scrypt hashing, DB sessions, Drizzle adapter and a TOTP two-factor plugin.
Public sign-up disabled; seed provisions accounts through Better Auth's own adapter and hasher.
Auth.js lacked built-in MFA; Lucia is deprecated.

## ADR-004 Tenant isolation: RLS (FORCE) + composite FKs + service authorization
Defense in depth: services authorize; RLS denies by default with transaction-local context;
composite FKs make cross-tenant relationships unrepresentable. Narrow `crm_system` BYPASSRLS
function owner for queue claims and form-token resolution (SECURITY.md).

## ADR-005 Contact resolution does not equate shared details with identity
Reuse a contact only on normalized name + (email or phone) match; otherwise create a new contact
and a duplicate suggestion. Merge review with impact preview is M2.

## ADR-006 Messaging: adapter contract + labeled local simulator
`MessagingProvider` declares `simulated` and `supportsIdempotentRetry`. The local simulator never
reports "delivered". Production config refuses it.

## ADR-007 Test strategy
Real PostgreSQL with the restricted runtime role for all integration tests; real worker processes
killed with SIGKILL for A3; injectable engine clock for timers/backoff; Playwright against a
production build plus a real worker for A15.

## ADR-008 Tooling versions
TypeScript 6.0.3 rather than 7.0 (native port) to avoid tool-integration risk; Playwright pinned
to 1.56.1 to match the Chromium build available offline in the development container.
