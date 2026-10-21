# Test results

Recorded 2026-10-21 in the development container (Linux, Node 22.22.0, PostgreSQL 16.15, Chromium
build 1194 via Playwright 1.56.1). These are the actual outputs of this session; CI
(`.github/workflows/ci.yml`) is configured but has **not** run yet on GitHub.

## Commands and outcomes
| Check | Command | Result |
| --- | --- | --- |
| Migrations on empty DB + seed | `pnpm db:reset` | ✅ applied `0000_init`, `0001_security`; seeded 2 tenants |
| Lint | `pnpm lint` | ✅ 0 errors, 0 warnings |
| Types | `pnpm typecheck` | ✅ 0 errors |
| Production build | `pnpm build` (part of `test:e2e`) | ✅ |
| Integration tests | `pnpm test` | ✅ 7 files, **48 passed**, 0 failed (≈31 s) |
| Browser tests | `pnpm test:e2e` | ✅ **3 passed**, 0 failed (≈11 s) |
| Dependency audit | `pnpm audit --prod` | ⚠️ 1 moderate (esbuild via drizzle-kit, dev-server only; see SECURITY.md) |

A regression was caught during this session: a date-formatting change broke task creation and
the suite failed 12 tests until it was fixed; the numbers above are from the run after the fix.

## Acceptance coverage
| ID | Status | Evidence |
| --- | --- | --- |
| A1 tenant isolation | ✅ passed | `a1-tenant-isolation.test.ts` (15) — services + RLS with `crm_app`, guessed ids, updates, exports, WITH CHECK, composite FK, missing context, pooled-connection leak, FORCE RLS on owner, append-only audit; E2E HTTP cross-tenant 404. *Subscription channels: none exist in M1, not tested.* |
| A2 duplicate events | ✅ passed | `a2-duplicate-events.test.ts` (5) — 10 sequential (+3 after processing) and 10 concurrent deliveries ⇒ 1 contact/opportunity/task/send/delivery, 13 attempts preserved; payload mismatch flagged; rejections/honeypot/rate-limit recorded |
| A3 worker restart | ✅ passed | `a3-worker-restart.test.ts` (3) — real worker processes SIGKILLed during a persisted wait, after provider acceptance, and before step commit; no lost task, exactly one simulated delivery |
| A4 version pinning | ✅ passed | `a4-version-pinning.test.ts` (3) — v1 run finishes on v1 after v2 publish; new run on v2; DB blocks version edits and re-pinning |
| A5 failures/recovery | ✅ passed | `a5-failures-and-recovery.test.ts` (6) — retryable ×2 then success (3 attempts, backoff), permanent fails once, review queue, retry + skip audited without redoing work; consent suppression; kill switch/pause hold sends |
| A6 restricted direct calls | ✅ passed | `a6-permissions.test.ts` (7) + E2E HTTP: restricted export 403, publish 403, cross-origin POST 403, anonymous 401 |
| A15 browser journey | ✅ passed | `tests/e2e/a15-lead-to-task.spec.ts` — form → Today task → contact timeline (8 event types incl. local-simulator acceptance) → staff completes task → run listed |
| A7–A14, A16 | ⬜ not implemented | Later milestones. A8 partially exercised (non-idempotent interrupted dispatch ⇒ `unknown` / needs review); not reported as passed. |

Not measured: performance targets (p95, 10k contacts × 2 tenants, 20 users), task-time benchmarks,
WCAG 2.2 AA conformance. Accessibility work done: semantic landmarks, skip link, labeled inputs,
`aria-current`, `role=alert/status` for results, visible focus, disabled controls with reasons,
responsive layout checked at 390 px and 1360 px. No automated accessibility audit has been run.

## Integration test list (verbatim from `vitest --reporter=verbose`)
```
 ✓ tests/integration/a3-worker-restart.test.ts > A3 worker crash and restart > survives a hard kill during a persisted wait 5959ms
 ✓ tests/integration/a3-worker-restart.test.ts > A3 worker crash and restart > does not resend when killed after the provider accepted but before recording the result 6501ms
 ✓ tests/integration/a3-worker-restart.test.ts > A3 worker crash and restart > rolls back a step that was interrupted before commit and performs it exactly once on restart 6389ms
 ✓ tests/integration/a4-version-pinning.test.ts > A4 workflow version pinning > an in-flight run stays on v1 after v2 is published; new runs use v2 470ms
 ✓ tests/integration/a4-version-pinning.test.ts > A4 workflow version pinning > the database blocks editing a published version or re-pinning a run 7ms
 ✓ tests/integration/a4-version-pinning.test.ts > A4 workflow version pinning > publishing an unchanged draft is refused 13ms
 ✓ tests/integration/a5-failures-and-recovery.test.ts > A5 failures, retries and recovery > backoff is exponential, jittered and capped 2ms
 ✓ tests/integration/a5-failures-and-recovery.test.ts > A5 failures, retries and recovery > a retryable provider failure is retried with backoff, then succeeds exactly once 326ms
 ✓ tests/integration/a5-failures-and-recovery.test.ts > A5 failures, retries and recovery > a permanent failure fails the run clearly, appears in the review queue, and recovers without redoing work 195ms
 ✓ tests/integration/a5-failures-and-recovery.test.ts > A5 failures, retries and recovery > a send without consent is suppressed at dispatch and the run continues 138ms
 ✓ tests/integration/a5-failures-and-recovery.test.ts > A5 failures, retries and recovery > the tenant kill switch and workflow pause hold queued sends until resumed 208ms
 ✓ tests/integration/a5-failures-and-recovery.test.ts > A5 failures, retries and recovery > an interrupted dispatch with a non-idempotent provider becomes 'unknown' and needs review (never blindly resent) 105ms
 ✓ tests/integration/a2-duplicate-events.test.ts > A2 duplicate source events > 10 sequential repeats of one submission create one set of business effects 341ms
 ✓ tests/integration/a2-duplicate-events.test.ts > A2 duplicate source events > 10 concurrent deliveries of one submission race safely to a single effect set 203ms
 ✓ tests/integration/a2-duplicate-events.test.ts > A2 duplicate source events > a repeated submission id with different content is ignored and flagged 51ms
 ✓ tests/integration/a2-duplicate-events.test.ts > A2 duplicate source events > validation rejections, honeypot hits and rate limiting are recorded without business effects 402ms
 ✓ tests/integration/a2-duplicate-events.test.ts > A2 duplicate source events > an unknown or malformed form token is rejected without touching any tenant 2ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 service layer > runs as the restricted runtime role (not owner, no BYPASSRLS) 5ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 service layer > lists only the actor's tenant 10ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 service layer > cannot read tenant B records by guessed id (404, existence not confirmed) 14ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 service layer > cannot update tenant B records 7ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 service layer > exports contain no tenant B data 10ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 service layer > ignores a client-supplied tenant the user is not a member of 3ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 database row-level security (runtime role) > tenant A context sees zero tenant B rows even when asking for them explicitly 4ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 database row-level security (runtime role) > tenant A context cannot update or delete tenant B rows 5ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 database row-level security (runtime role) > tenant A context cannot insert rows labeled as tenant B (WITH CHECK) 4ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 database row-level security (runtime role) > composite foreign keys reject cross-tenant relationships 4ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 database row-level security (runtime role) > missing tenant context denies reads and writes 4ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 database row-level security (runtime role) > tenant context is transaction-local and never leaks across pooled requests 12ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 database row-level security (runtime role) > the owner role is also subject to RLS (FORCE ROW LEVEL SECURITY) 11ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 database row-level security (runtime role) > audit events are append-only for every role 12ms
 ✓ tests/integration/a1-tenant-isolation.test.ts > A1 database row-level security (runtime role) > queue claim functions return identifiers only and the runtime role cannot assume crm_system 2ms
 ✓ tests/integration/a6-permissions.test.ts > A6 restricted and read-only roles > restricted staff cannot publish, edit, pause or operate workflows 6ms
 ✓ tests/integration/a6-permissions.test.ts > A6 restricted and read-only roles > staff and read-only users cannot publish either 1ms
 ✓ tests/integration/a6-permissions.test.ts > A6 restricted and read-only roles > restricted, staff and read-only users cannot export 4ms
 ✓ tests/integration/a6-permissions.test.ts > A6 restricted and read-only roles > restricted staff see masked contact details 20ms
 ✓ tests/integration/a6-permissions.test.ts > A6 restricted and read-only roles > restricted staff can only complete their own tasks; read-only cannot complete any 6ms
 ✓ tests/integration/a6-permissions.test.ts > A6 restricted and read-only roles > only owners manage roles; only managers control forms and sending 3ms
 ✓ tests/integration/a6-permissions.test.ts > A6 restricted and read-only roles > role changes by an owner are audited 17ms
 ✓ tests/integration/definition-and-config.test.ts > workflow definition validation > accepts the reference workflow 3ms
 ✓ tests/integration/definition-and-config.test.ts > workflow definition validation > rejects cycles 1ms
 ✓ tests/integration/definition-and-config.test.ts > workflow definition validation > rejects missing references and unreachable steps 0ms
 ✓ tests/integration/definition-and-config.test.ts > workflow definition validation > rejects unknown template variables and unsupported node types 4ms
 ✓ tests/integration/definition-and-config.test.ts > workflow definition validation > rejects a task-completed condition on a task that may not have run 0ms
 ✓ tests/integration/definition-and-config.test.ts > workflow definition validation > rejects marketing purpose in Milestone 1 1ms
 ✓ tests/integration/definition-and-config.test.ts > configuration guards > rejects the local simulation adapter in production 2ms
 ✓ tests/integration/definition-and-config.test.ts > configuration guards > rejects fault injection in production 0ms
 ✓ tests/integration/definition-and-config.test.ts > configuration guards > accepts the local adapter in development 0ms
 Test Files  7 passed (7)
      Tests  48 passed (48)
   Duration  30.86s (tests 87%, import 12%, transform 1%)
```

## Browser test list
```
  ✓  1 tests/e2e/a15-lead-to-task.spec.ts:19:1 › lead form submission becomes assigned staff work with an auditable timeline (2.4s)
  ✓  2 tests/e2e/a15-lead-to-task.spec.ts:69:1 › direct API calls enforce permissions and tenant isolation (A6/A1 over HTTP) (1.3s)
  ✓  3 tests/e2e/a15-lead-to-task.spec.ts:104:1 › manager can export CSV and sees the failed-automation review queue control (672ms)
  3 passed (10.8s)
```
