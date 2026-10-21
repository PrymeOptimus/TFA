# Backlog

Status legend: ✅ done in M1 · 🟡 partial in M1 · ⬜ not started.

## Milestone 1 follow-ups (small, found during this build)
- ⬜ Owner policy "require MFA for all members"; MFA enrollment QR code (setup key + URI shown today).
- ⬜ Content-Security-Policy header; Playwright accessibility scan (axe) across pages.
- ⬜ Opportunity stage change as a workflow trigger (event is audited today, not consumed).
- ⬜ Duplicate-merge review with impact preview (suggestions are shown, not actionable).
- ⬜ Multiple pipelines management UI (schema supports it).
- ⬜ CSV import with dry run, mapping, row errors, duplicate policy, batch provenance.
- ⬜ Global permission-aware search across record types (contacts search exists).
- ⬜ Load test: 2 tenants × 10,000 contacts, 20 concurrent users; p95 targets are hypotheses.

## Milestone 2 — private operational pilot
- ⬜ Twilio SMS adapter (A2P 10DLC onboarding), one email provider adapter; signed webhooks with raw-body verification, replay protection, inbox dedupe, out-of-order rules (A10).
- 🟡 Consent/suppression: ledger + dispatch checks done; STOP/opt-out ingestion, provider/platform sync, cancel queued on opt-out (A7) pending.
- ⬜ Provider-accepted-then-lost-response reconciliation via provider ids (A8; ambiguous path done for non-idempotent providers).
- ⬜ Sending windows by recipient timezone, rate limits, budgets with atomic reservations (A9).
- ⬜ Human approval node; signed outbound webhooks with SSRF protections.
- ⬜ Side-effect-free workflow simulation with test clock and expected actions; explicit replay semantics.
- ⬜ Internal scheduling (services, availability, buffers, DST, DB-level booking concurrency) (A14 part).
- ⬜ Manual outbound replies in Inbox; conversation assignment UI.
- ⬜ Connector diagnostics page; Reports v1 (lead source, response time, overdue, booking rate, workflow failures) with metric definitions.

## Milestone 3 — commercial foundation
- ⬜ Tenant onboarding, invitations, verified ownership; Stripe subscriptions + entitlements (A10); usage/cost ledger.
- ⬜ Full tenant export/import round trip with manifest and checksums (A12); retention/deletion jobs.
- ⬜ Backups + PITR + recovery drill with measured RTO/RPO (A16); tenant-scoped recovery.
- ⬜ Time-limited, tenant-approved support access; OTel SDK + exporter; runbooks; SBOM, secret scanning, independent security review.

## Milestone 4 — differentiated modules
- ⬜ Clinic operations (referrals, authorizations, visit allowances, PI cases) on synthetic data.
- ⬜ Jane: verify partner approval/scopes first; otherwise labeled import/booking handoff (never simulated bookings).
- ⬜ Google/Microsoft calendar connectors; reconciled revenue reporting (A13); governed AI assistance (A11).

## Milestone 5 and later
Consent-aware campaigns, landing-page templates, agency template deployment, white-label domains,
custom entities; voice AI, social, courses, communities, marketplace only when demand justifies.

## Unresolved external dependencies
| Dependency | Status |
| --- | --- |
| Twilio account, A2P 10DLC brand/campaign registration | Not available — blocked for M2 |
| Email provider account + domain (SPF/DKIM/DMARC) | Not selected |
| Stripe account | Not available — M3 |
| Jane API partner approval and scopes | Unverified; do not build until confirmed |
| Gmail / Microsoft 365 / Zoho OAuth app registration | Not started |
| Hosting, managed PostgreSQL with PITR, secrets manager | Not selected |
| Legal review: terms, privacy, BAA chain, consent language per jurisdiction | Not started (requires qualified counsel) |
| Product name / trademark availability | Not checked |
