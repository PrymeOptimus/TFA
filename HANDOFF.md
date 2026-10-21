# Next-session handoff

**Where things stand (2026-10-21):** Milestone 1 implemented and passing locally (48 integration +
3 browser tests; lint/types/build clean). Classification: **local prototype**. Not a private
pilot: no real providers, no deployment, no backups, no security review.

## Start here next time
1. `pnpm install && pnpm db:reset && pnpm test && pnpm test:e2e` — confirm green before changes.
2. Read BACKLOG.md "Milestone 1 follow-ups", then choose Milestone 2 work.
3. Confirm with the founder before M2: which SMS provider account (Twilio assumed), which email
   provider, which business is the authorized pilot tenant, and approved consent language.

## Recommended Milestone 2 order
1. Opt-out/STOP handling + suppression sync + cancel-queued-on-opt-out (A7) — still local.
2. Webhook inbox with signature verification against raw bodies, replay windows, out-of-order
   status rules (A10 messaging part), using provider fixture payloads.
3. Twilio SMS adapter behind `MessagingProvider` (idempotency + reconciliation by provider id, A8).
4. Sending windows, per-tenant rate limits and budget reservations (A9).
5. Workflow simulation (no side effects) + human-approval node.
6. Internal scheduling module (A14 DST + concurrency parts) and Reports v1.

## Known sharp edges
- Auth rate limiting is in-memory per process (fine locally; shared store needed for >1 instance).
- Engine polls every 500 ms; throughput not measured.
- Retrying a failed DB step manually gives one more attempt (attempt count is cumulative).
- `crm_system` BYPASSRLS function owner is a deliberate exception — keep it to id-returning functions.
- Vendor documentation sites were unreachable from this container; APIs were verified from the
  installed packages' type declarations. Re-verify against vendor docs at the start of M2.
