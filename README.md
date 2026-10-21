# Agentic Operations CRM (provisional name)

Independently owned operations CRM for appointment-based service businesses, built by Agentic
Innovations. **Status: Milestone 1 — local prototype.** Synthetic data only. Messaging uses a
clearly labeled **local simulation adapter**; no real SMS or email is ever sent. Not deployed,
not reviewed for healthcare use, not a commercial release.

What works end to end: public lead form → idempotent ingestion → contact resolution + consent
ledger → durable workflow run (pinned to a published version) → opportunity → assigned staff task
→ queued acknowledgment → dispatch-policy check → local simulated send → auditable timeline →
staff completes the task.

## Quick start

Prerequisites: Node 22.12+, pnpm 10, PostgreSQL 16 (Docker Compose provided).

```bash
pnpm install
# 1. Database (choose one)
docker compose up -d postgres                      # creates roles + crm_dev/crm_test on first start
# or, with a local PostgreSQL 16 superuser:
psql -U postgres -f infra/postgres/01-bootstrap.sql

# 2. Environment
cp .env.example .env
# set BETTER_AUTH_SECRET (openssl rand -base64 32) and IP_HASH_SALT (openssl rand -hex 16)

# 3. Schema + synthetic seed
pnpm db:reset            # drop/recreate schema, run migrations, seed two demo businesses

# 4. Run (two terminals)
pnpm dev                 # web app on http://localhost:3000
pnpm worker              # durable workflow + outbox worker (required for automations)
```

Demo accounts (synthetic, local only — password `Demo-Password-2026!`, override with `SEED_PASSWORD`):

| Email | Business | Role |
| --- | --- | --- |
| founder@agentic.test | both (switcher) | owner |
| owner@brightline.test | Brightline Wellness (Demo) | owner |
| manager@brightline.test | Brightline Wellness (Demo) | manager |
| frontdesk@brightline.test | Brightline Wellness (Demo) | staff |
| restricted@brightline.test | Brightline Wellness (Demo) | restricted staff |
| readonly@brightline.test | Brightline Wellness (Demo) | read-only |
| owner@harbor.test / staff@harbor.test | Harbor Home Services (Demo) | owner / staff |

Public lead forms: `http://localhost:3000/f/demo-brightline-lead-form-local-token` and
`/f/demo-harbor-lead-form-local-token` (deterministic tokens for local demo only; rotate in
Settings → Lead forms).

Local simulator failure rules (synthetic numbers): a phone ending **0198** fails twice then
succeeds (retryable); ending **0199** fails permanently. Any other number is accepted by the
simulator — "accepted", never "delivered".

## Checks

```bash
pnpm lint && pnpm typecheck
pnpm test        # Vitest integration tests on crm_test (A1–A6), real PostgreSQL, runtime role
pnpm test:e2e    # next build + Playwright (A15) on crm_e2e, real worker process
```

Results from this session: see [TEST_RESULTS.md](TEST_RESULTS.md).

## Founder demo script (≈10 minutes)

1. **Isolation.** Sign in as `founder@agentic.test`. Note the business switcher (bottom-left). Switch
   between Brightline and Harbor; contacts, pipelines and automations never mix.
2. **Lead capture.** In a private window open the Brightline form with `?utm_source=google`. Submit
   "Jamie Rivera", phone `(404) 555-0133`, a message, and tick the SMS checkbox.
3. **Today queue.** Back as founder (Brightline) → **Today**: "Call Jamie about their web inquiry"
   (owner Jordan Frontdesk, due in 15 min) and an "Unanswered inquiry" row.
4. **Timeline.** Click *Jamie Rivera*: form submission, consent (exact checkbox text), contact
   creation, automation start (v1), opportunity, task, queued SMS, and *"accepted by LOCAL
   SIMULATOR — no real message was sent"*, each with its source.
5. **Duplicate handling.** Replay one source event several times with the same idempotency key:
   ```bash
   for i in 1 2 3; do curl -s -X POST localhost:3000/api/public/forms/demo-brightline-lead-form-local-token \
     -H 'content-type: application/json' -H 'idempotency-key: 11111111-2222-4333-8444-555555555555' \
     -d '{"fields":{"firstName":"Casey","lastName":"Replay","phone":"(404) 555-0144","smsConsent":true}}'; echo; done
   ```
   First response `received`, then `already_received`. Casey Replay's timeline shows two
   *"Repeat … no records created"* events and still one opportunity, one task, one message.
6. **Run inspection.** Automations → recent run: pinned version + content hash, step attempts with
   worker ids, a durable timer, delivery evidence, correlation id.
7. **Worker restart.** Stop `pnpm worker` (Ctrl-C) during the 2-minute wait, wait past the timer,
   restart it: the run resumes and escalates to Morgan Manager exactly once (A3 proves the same
   with SIGKILL).
8. **Version pinning.** Open *New lead follow-up*, change the escalation title, **Save draft**,
   **Publish v2** with a summary. Submit another lead: new run shows v2; the earlier run stays v1.
9. **Failure + recovery.** Submit a lead with phone `(404) 555-0199`. Today → *Failed automations*
   → *Review run* → error is explicit. *Retry* (fails again, no duplicate task) or *Skip step* with
   a reason; both are audited.
10. **Permissions.** Sign in as `restricted@brightline.test`: masked phone/email, no export, no
    publish. Settings → kill switch (as manager) holds all sends until resumed.
11. **Work completion.** As `frontdesk@brightline.test`, complete the call task from Today; the
    timeline records it and the later branch takes the "completed" path.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/db/schema.ts`, `drizzle/` | Schema (Drizzle) and migrations; `0001_security.sql` = RLS, grants, triggers, queue functions |
| `src/server/services/` | Business rules (ingest, CRM, workflows, settings). UI, API and worker all call these |
| `src/server/engine/` | Durable workflow runtime + outbox dispatcher; test-only fault injection |
| `src/server/messaging/` | Provider adapter contract + local simulator |
| `src/server/workflow/` | Versioned definition schema and publication validation |
| `src/app/` | Next.js UI, `/api/v1/*` routes, public form `/f/[token]` |
| `src/worker/main.ts` | Worker process |
| `tests/integration/`, `tests/e2e/` | Acceptance tests A1–A6, A15 |

Docs: [PRODUCT](PRODUCT.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATA_MODEL](DATA_MODEL.md) ·
[SECURITY](SECURITY.md) · [DECISIONS](DECISIONS.md) · [BACKLOG](BACKLOG.md) ·
[TEST_RESULTS](TEST_RESULTS.md) · [HANDOFF](HANDOFF.md)
