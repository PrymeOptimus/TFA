# Product

**Working name:** Agentic Operations CRM (provisional; name availability not checked).
**Company:** Agentic Innovations · **Founder:** Deon Aiken.

## Buyer hypothesis (unvalidated)
Small appointment-based service businesses (owner + operations manager + front-desk staff) that
lose revenue through unanswered inquiries and incomplete follow-up. Optional clinic operations is
the first vertical module (Milestone 4); the core stays generic.

## Where we intend to win (to be measured, not claimed)
1. Reliable follow-up: every inquiry gets an accountable owner and a visible next action.
2. A short staff workday: Today queue = overdue work, unanswered inquiries, failed automations.
3. Explainable automation: every run pinned to an immutable version, every step attempt visible.
4. Honest communication evidence: queued / provider-accepted / delivered / failed / unknown are
   distinct; simulation is labeled.
5. Portability and transparent costs (later milestones).

No claim of being faster, cheaper, more reliable or superior to HighLevel is made; those require
equivalent measured tasks.

## Milestone 1 scope (this build)
Delivered: tenant isolation (RLS + composite FKs), Better Auth sign-in with TOTP MFA, five roles,
two synthetic businesses, contacts list/detail/search, one pipeline with stage moves, Today task
queue with completion, public lead form with consent/UTM/spam/rate controls and idempotent
ingestion, one editable workflow (structured editor, draft vs. immutable versions, pause), durable
runs with timers/retries/operator recovery, transactional outbox + local simulated SMS/email,
conversation timeline with internal notes, run/step inspection, audit log, permission-aware CSV
export, deterministic seed, tests A1–A6 and A15.

Explicitly not in Milestone 1: real outbound messaging, payments, appointments, reports, AI,
page builder, agency UI, clinic module, real PHI. Navigation shows Appointments and Reports as
disabled "Planned" items with an explanation.

## Assumptions
- Default timezone America/New_York; instants stored UTC; tenant timezone stored.
- A person's presence in a clinic CRM can itself be sensitive; all demo data is synthetic
  (`.test` emails, 555-01xx numbers).
- Separate businesses are separate tenants; a person with several memberships switches explicitly.
- Jane/Gmail/Microsoft 365/Zoho access is unconfirmed; no connector is implemented or implied.
