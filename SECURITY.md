# Security (Milestone 1)

This is a local prototype. It is **not** HIPAA compliant, certified, or reviewed for production,
and must not hold real patient or client data. Controls below are implemented and, where noted,
tested; they are not an audit.

## Database roles
| Role | Login | Owns tables | BYPASSRLS | Used by |
| --- | --- | --- | --- | --- |
| `crm_owner` | yes | yes | no (and `FORCE RLS` applies to it) | migrations, seed only |
| `crm_app` | yes | no | no | web app + worker at runtime |
| `crm_system` | **no** | no | yes | owns 3 `SECURITY DEFINER` functions only |

`crm_system` functions (`resolve_public_form`, `engine_claim_runs`, `engine_claim_outbox`) return
only identifiers/leases; all record access then happens as `crm_app` under tenant context.
`crm_app` cannot `SET ROLE crm_system` (tested). This BYPASSRLS exception is deliberate and narrow;
review it before production.

## Tenant isolation (tested: A1)
- RLS `USING/WITH CHECK (tenant_id = app_current_tenant())` on every tenant table, `FORCE` enabled.
- Missing context ⇒ NULL ⇒ no rows, inserts rejected.
- Context bound transaction-locally; verified it does not survive on a reused pooled connection.
- Composite FKs reject cross-tenant relationships even if application code were wrong.
- Tenant scope comes from verified membership; client-supplied tenant ids are ignored.
- Out-of-tenant ids return 404 (existence not confirmed).
- Public form tokens: stored as SHA-256; a token resolves exactly one form/tenant.

## Authentication
Better Auth 1.7.12: scrypt password hashing, database sessions (12 h), HTTP-only cookies (secure
in production), TOTP MFA with backup codes, public sign-up disabled, explicit rate limits
(sign-in 10/min/IP by default; in-memory per process — a shared store is required before running
more than one web instance). MFA is optional per user in M1; an owner "require MFA" policy is
backlog.

## Authorization (tested: A6)
Server-side permission checks in every service function (UI hiding is cosmetic). Restricted staff
and read-only users see masked email/phone and message bodies; only owners/managers export,
publish, operate workflows, rotate form links or pause sending; only owners change roles; all
role changes are audited.

## Web
- API routes reject cross-origin state-changing requests (Origin check); server actions use
  Next.js' built-in origin checks. Unauthenticated API ⇒ 401.
- Headers: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options:
  DENY` except the embeddable public form. A full CSP is backlog.
- CSV export neutralizes formula injection; exports are audited.
- Public form: zod validation, honeypot, per-IP-hash rate limit (10/min), consent captured only from
  explicit checkboxes with the exact text shown.

## Messaging safety
Local simulation only; `APP_ENV=production` refuses the local adapter and fault injection. The
dispatcher re-checks tenant kill switch, workflow pause, consent and suppression immediately
before sending. Exactly-once delivery is not claimed; interrupted dispatches are deduplicated by
idempotency key or routed to review as `unknown`.

## Logging and secrets
pino redacts emails, phones, bodies, form fields, tokens, passwords, cookies and auth headers.
`.env` is git-ignored; `.env.example` holds placeholders; local role passwords in
`infra/postgres/01-bootstrap.sql` are local-only placeholders.

## Dependency posture (2026-10-21)
- `pnpm audit --prod`: 1 moderate — esbuild ≤0.24.2 (GHSA-67mh-4wv8-2f99, dev-server request
  issue) reached via `better-auth → drizzle-kit → @esbuild-kit/*`. It affects the esbuild dev
  server, which this app does not run in production; track for an upstream fix.
- Production licenses: MIT 130, Apache-2.0 13, ISC 7, MPL-2.0 3, BSD-3-Clause 2, 0BSD 1,
  CC-BY-4.0 1 (caniuse-lite data), LGPL-3.0-or-later 2 (`@img/sharp-libvips-*`, optional native
  image library pulled by Next.js; dynamically linked — confirm obligations before redistribution).
  SBOM generation and secret scanning in CI are backlog (M3).

## Not yet implemented (production blockers)
Healthcare release gate (risk assessment, BAAs, approved services), support-access model, CSP,
shared rate-limit store, secrets manager, backups/PITR + recovery drill, webhook signature
validation (no webhooks in M1), SSRF controls (no outbound webhooks in M1), independent security
review.
