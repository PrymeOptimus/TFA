# Data dictionary (Milestone 1 entities)

All tenant-owned tables carry `tenant_id`, `UNIQUE (tenant_id, id)`, RLS (`FORCE`) and composite
foreign keys `(tenant_id, x_id)`. Timestamps are `timestamptz` (UTC). IDs are UUIDs (Better Auth
identity tables use its text ids). Append-only tables reject UPDATE/DELETE via trigger.

| Entity (table) | Scope | Purpose / key rules |
| --- | --- | --- |
| Tenant (`tenant`) | platform | A legally/operationally separate business. Timezone, `sending_paused` kill switch, `is_synthetic`. Created only by provisioning (owner role). |
| Location (`location`) | tenant | Physical location + IANA timezone. |
| User (`auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_two_factor`) | platform | Better Auth identity, sessions, scrypt password hash, TOTP secret/backup codes. Never exported. |
| Membership (`membership`) | tenant | User ↔ tenant with role. `UNIQUE (tenant_id, user_id)`; readable by the user across tenants (to pick one). |
| Role / Permission | code | Roles: owner, manager, staff, restricted_staff, read_only (`member_role` enum). Permission map in `src/server/authz.ts`. |
| Contact (`contact`) | tenant | Person. Raw + normalized email (lowercase) and phone (E.164), normalized name, owner membership, source, tags. Tenant-leading indexes. |
| Duplicate suggestion (`duplicate_suggestion`) | tenant | Created when email/phone matches but name differs; never auto-merged. |
| Pipeline / Stage (`pipeline`, `stage`) | tenant | Stage kind open/won/lost; `(tenant, pipeline, stage)` FK guarantees an opportunity's stage belongs to its pipeline. |
| Opportunity (`opportunity`) | tenant | Several per contact. Estimated value in minor units + ISO currency (estimate ≠ collected revenue). `created_by_run_id`. |
| Task (`task`) | tenant | Assignee must be a member (composite FK to membership). Due, status, completion actor. |
| Form (`form`) | tenant | Public form; stores SHA-256 of the public token + hint; consent texts shown. |
| InboxEvent (`inbox_event`) | tenant | One row per source event identity `(tenant, source, source_key)`; receive count, payload hash, result. |
| Ingest attempt (`ingest_attempt`) | tenant, append-only | Every receipt incl. duplicates, mismatches, validation rejections, honeypot, rate limits. Hashed IP only. |
| FormSubmission (`form_submission`) | tenant | Fields + attribution (UTM/referrer/page) per accepted event. |
| ConsentEvent (`consent_event`) | tenant, append-only | Ledger: channel, purpose (transactional/marketing), granted/revoked, source, evidence (exact text, submission id). Current = latest. |
| Suppression (`suppression`) | tenant | Channel + address blocked at dispatch. (Opt-out ingestion: M2.) |
| Conversation (`conversation`) | tenant | One per contact in M1; unanswered flag, assignee, activity times. |
| Message (`message`) | tenant | inbound / outbound / note. Status: recorded, queued, dispatching, provider_accepted, delivered, failed, suppressed, unknown. `simulated` flag, provider id, idempotency key (unique). |
| Message event (`message_event`) | tenant, append-only | Delivery evidence timeline; `inferred` flag for inferred statuses. |
| OutboxEvent (`outbox_event`) | tenant | External effect request: status, attempts/max, next attempt, lease, last error. Unique idempotency key. |
| WorkflowDefinition (`workflow`) | tenant | Name, trigger, editable draft, active version, paused, version retention policy (≥400 days). |
| WorkflowVersion (`workflow_version`) | tenant, immutable | version n, schema version, definition JSON, `sha256:` content hash, change summary, publisher. |
| WorkflowRun (`workflow_run`) | tenant | Pinned version (trigger-enforced), trigger event (unique per workflow), status, current step, context, `wake_at`, lease, correlation id, error. |
| StepAttempt (`step_attempt`) | tenant, append-only | Every attempt: status, worker id, output, error, retry time. |
| Step effect (`step_effect`) | tenant | Completed-effect ledger per (run, step); pending/completed. Prevents repeated effects on retry/replay. |
| AuditEvent (`audit_event`) | tenant, append-only | Actor type/id, action, entity, contact (timeline), correlation id, summary, data. |
| Local simulator (`local_sim_delivery`, `local_sim_attempt`) | tenant | The simulated provider's own records (stand-in for an external system). |

Not yet introduced (backlog, by milestone): Company, ContactRelationship, CustomFieldDefinition,
ChannelConnection, IntegrationConnection, SyncCheckpoint, Subscription, Entitlement, UsageEvent,
CostRate, ExportJob, FileAsset; clinic entities (Referral, Authorization, VisitAllowance, Case,
CaseParty, CaseTask, CaseStatusEvent).
