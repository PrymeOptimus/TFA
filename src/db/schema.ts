/**
 * Authoritative relational schema (Drizzle). Row-level security, grants, immutability triggers and
 * SECURITY DEFINER queue functions live in the hand-written migration drizzle/0001_security.sql.
 *
 * Conventions
 * - Every tenant-owned table carries tenant_id and a UNIQUE (tenant_id, id) key.
 * - Cross-table references inside a tenant use composite foreign keys (tenant_id, x_id) so the
 *   database itself rejects a relationship that crosses tenants.
 * - Instants are timestamptz (UTC); the relevant IANA zone is stored on tenant/location.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const id = () => uuid("id").primaryKey().defaultRandom();
const tenantId = () => uuid("tenant_id").notNull();

// ---------------------------------------------------------------------------------------------
// Identity (Better Auth). Platform-scoped, not tenant-scoped: a person may belong to several
// tenants through explicit memberships. Table shapes follow better-auth 1.7 core + twoFactor.
// ---------------------------------------------------------------------------------------------
export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_account_user_idx").on(t.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

export const authTwoFactor = pgTable(
  "auth_two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: ts("locked_until"),
  },
  (t) => [index("auth_two_factor_user_idx").on(t.userId), index("auth_two_factor_secret_idx").on(t.secret)],
);

// ---------------------------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------------------------
export const roleEnum = pgEnum("member_role", ["owner", "manager", "staff", "restricted_staff", "read_only"]);

export const tenant = pgTable("tenant", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/New_York"),
  /** Tenant kill switch: when true, no outbound message is dispatched. */
  sendingPaused: boolean("sending_paused").notNull().default(false),
  sendingPausedReason: text("sending_paused_reason"),
  isSynthetic: boolean("is_synthetic").notNull().default(true),
  createdAt: createdAt(),
});

export const location = pgTable(
  "location",
  {
    id: id(),
    tenantId: tenantId().references(() => tenant.id),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("America/New_York"),
    createdAt: createdAt(),
  },
  (t) => [unique("location_tenant_id_key").on(t.tenantId, t.id)],
);

export const membership = pgTable(
  "membership",
  {
    id: id(),
    tenantId: tenantId().references(() => tenant.id),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("membership_tenant_user_key").on(t.tenantId, t.userId),
    unique("membership_tenant_id_key").on(t.tenantId, t.id),
    index("membership_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------------------------
// CRM core
// ---------------------------------------------------------------------------------------------
export const contact = pgTable(
  "contact",
  {
    id: id(),
    tenantId: tenantId().references(() => tenant.id),
    locationId: uuid("location_id"),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    displayName: text("display_name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    phoneE164: text("phone_e164"),
    ownerUserId: text("owner_user_id"),
    source: text("source").notNull().default("manual"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("contact_tenant_id_key").on(t.tenantId, t.id),
    index("contact_tenant_email_idx").on(t.tenantId, t.emailNormalized),
    index("contact_tenant_phone_idx").on(t.tenantId, t.phoneE164),
    index("contact_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("contact_tenant_name_idx").on(t.tenantId, t.nameNormalized),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [location.tenantId, location.id] }),
    foreignKey({
      name: "contact_owner_membership_fk",
      columns: [t.tenantId, t.ownerUserId],
      foreignColumns: [membership.tenantId, membership.userId],
    }),
  ],
);

export const duplicateSuggestion = pgTable(
  "duplicate_suggestion",
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid("contact_id").notNull(),
    candidateContactId: uuid("candidate_contact_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("duplicate_suggestion_pair_key").on(t.tenantId, t.contactId, t.candidateContactId),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contact.tenantId, contact.id] }),
    foreignKey({ columns: [t.tenantId, t.candidateContactId], foreignColumns: [contact.tenantId, contact.id] }),
  ],
);

export const pipeline = pgTable(
  "pipeline",
  {
    id: id(),
    tenantId: tenantId().references(() => tenant.id),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [unique("pipeline_tenant_id_key").on(t.tenantId, t.id)],
);

export const stageKindEnum = pgEnum("stage_kind", ["open", "won", "lost"]);

export const stage = pgTable(
  "stage",
  {
    id: id(),
    tenantId: tenantId(),
    pipelineId: uuid("pipeline_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    kind: stageKindEnum("kind").notNull().default("open"),
  },
  (t) => [
    unique("stage_tenant_id_key").on(t.tenantId, t.id),
    unique("stage_tenant_pipeline_id_key").on(t.tenantId, t.pipelineId, t.id),
    foreignKey({ columns: [t.tenantId, t.pipelineId], foreignColumns: [pipeline.tenantId, pipeline.id] }),
  ],
);

export const opportunity = pgTable(
  "opportunity",
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid("contact_id").notNull(),
    pipelineId: uuid("pipeline_id").notNull(),
    stageId: uuid("stage_id").notNull(),
    name: text("name").notNull(),
    /** Estimated value in minor units. Pipeline value is not collected cash. */
    valueCents: bigint("value_cents", { mode: "number" }),
    currency: text("currency").notNull().default("USD"),
    ownerUserId: text("owner_user_id"),
    createdByRunId: uuid("created_by_run_id"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("opportunity_tenant_id_key").on(t.tenantId, t.id),
    index("opportunity_tenant_stage_idx").on(t.tenantId, t.pipelineId, t.stageId),
    index("opportunity_tenant_contact_idx").on(t.tenantId, t.contactId),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contact.tenantId, contact.id] }),
    foreignKey({
      name: "opportunity_stage_in_pipeline_fk",
      columns: [t.tenantId, t.pipelineId, t.stageId],
      foreignColumns: [stage.tenantId, stage.pipelineId, stage.id],
    }),
    foreignKey({
      name: "opportunity_owner_membership_fk",
      columns: [t.tenantId, t.ownerUserId],
      foreignColumns: [membership.tenantId, membership.userId],
    }),
    check("opportunity_currency_iso", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const taskStatusEnum = pgEnum("task_status", ["open", "completed", "cancelled"]);

export const task = pgTable(
  "task",
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid("contact_id"),
    opportunityId: uuid("opportunity_id"),
    title: text("title").notNull(),
    description: text("description"),
    assigneeUserId: text("assignee_user_id"),
    dueAt: ts("due_at"),
    status: taskStatusEnum("status").notNull().default("open"),
    completedAt: ts("completed_at"),
    completedByUserId: text("completed_by_user_id"),
    createdByRunId: uuid("created_by_run_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("task_tenant_id_key").on(t.tenantId, t.id),
    index("task_tenant_queue_idx").on(t.tenantId, t.status, t.dueAt),
    index("task_tenant_assignee_idx").on(t.tenantId, t.assigneeUserId, t.status),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contact.tenantId, contact.id] }),
    foreignKey({ columns: [t.tenantId, t.opportunityId], foreignColumns: [opportunity.tenantId, opportunity.id] }),
    foreignKey({
      name: "task_assignee_membership_fk",
      columns: [t.tenantId, t.assigneeUserId],
      foreignColumns: [membership.tenantId, membership.userId],
    }),
  ],
);

// ---------------------------------------------------------------------------------------------
// Forms, inbox (ingestion), consent
// ---------------------------------------------------------------------------------------------
export const form = pgTable(
  "form",
  {
    id: id(),
    tenantId: tenantId().references(() => tenant.id),
    name: text("name").notNull(),
    /** SHA-256 of the public form token. The token only authorizes submissions to this form. */
    tokenHash: text("token_hash").notNull().unique(),
    tokenHint: text("token_hint").notNull(),
    active: boolean("active").notNull().default(true),
    smsConsentText: text("sms_consent_text").notNull(),
    marketingConsentText: text("marketing_consent_text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("form_tenant_id_key").on(t.tenantId, t.id)],
);

export const inboxEvent = pgTable(
  "inbox_event",
  {
    id: id(),
    tenantId: tenantId(),
    source: text("source").notNull(),
    /** Stable identity of the source event (e.g. form id + client submission id). */
    sourceKey: text("source_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    receiveCount: integer("receive_count").notNull().default(1),
    firstReceivedAt: ts("first_received_at").notNull().defaultNow(),
    lastReceivedAt: ts("last_received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    result: jsonb("result").$type<Record<string, unknown>>(),
  },
  (t) => [
    unique("inbox_event_tenant_id_key").on(t.tenantId, t.id),
    unique("inbox_event_source_key").on(t.tenantId, t.source, t.sourceKey),
  ],
);

/** Every receipt of a source event, including duplicates and rejections (append-only). */
export const ingestAttempt = pgTable(
  "ingest_attempt",
  {
    id: id(),
    tenantId: tenantId(),
    inboxEventId: uuid("inbox_event_id"),
    source: text("source").notNull(),
    sourceKey: text("source_key"),
    payloadHash: text("payload_hash"),
    outcome: text("outcome").notNull(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    correlationId: text("correlation_id").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [
    index("ingest_attempt_tenant_key_idx").on(t.tenantId, t.source, t.sourceKey),
    index("ingest_attempt_rate_idx").on(t.tenantId, t.ipHash, t.receivedAt),
    foreignKey({ columns: [t.tenantId, t.inboxEventId], foreignColumns: [inboxEvent.tenantId, inboxEvent.id] }),
  ],
);

export const formSubmission = pgTable(
  "form_submission",
  {
    id: id(),
    tenantId: tenantId(),
    formId: uuid("form_id").notNull(),
    inboxEventId: uuid("inbox_event_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    fields: jsonb("fields").$type<Record<string, string>>().notNull(),
    attribution: jsonb("attribution").$type<Record<string, string>>().notNull(),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
  },
  (t) => [
    unique("form_submission_tenant_id_key").on(t.tenantId, t.id),
    unique("form_submission_inbox_key").on(t.tenantId, t.inboxEventId),
    foreignKey({ columns: [t.tenantId, t.formId], foreignColumns: [form.tenantId, form.id] }),
    foreignKey({ columns: [t.tenantId, t.inboxEventId], foreignColumns: [inboxEvent.tenantId, inboxEvent.id] }),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contact.tenantId, contact.id] }),
  ],
);

export const channelEnum = pgEnum("channel", ["sms", "email"]);
export const purposeEnum = pgEnum("message_purpose", ["transactional", "marketing"]);

/** Append-only consent ledger. Current consent = latest event per (contact, channel, purpose). */
export const consentEvent = pgTable(
  "consent_event",
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid("contact_id").notNull(),
    channel: channelEnum("channel").notNull(),
    purpose: purposeEnum("purpose").notNull(),
    action: text("action").notNull(), // granted | revoked
    source: text("source").notNull(), // form | user | provider
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("consent_event_lookup_idx").on(t.tenantId, t.contactId, t.channel, t.purpose, t.occurredAt),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contact.tenantId, contact.id] }),
    check("consent_event_action", sql`${t.action} in ('granted','revoked')`),
  ],
);

export const suppression = pgTable(
  "suppression",
  {
    id: id(),
    tenantId: tenantId(),
    channel: channelEnum("channel").notNull(),
    address: text("address").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("suppression_address_key").on(t.tenantId, t.channel, t.address)],
);

// ---------------------------------------------------------------------------------------------
// Conversations and messages
// ---------------------------------------------------------------------------------------------
export const conversation = pgTable(
  "conversation",
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid("contact_id").notNull(),
    assigneeUserId: text("assignee_user_id"),
    unanswered: boolean("unanswered").notNull().default(false),
    lastInboundAt: ts("last_inbound_at"),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conversation_tenant_id_key").on(t.tenantId, t.id),
    unique("conversation_contact_key").on(t.tenantId, t.contactId),
    index("conversation_tenant_activity_idx").on(t.tenantId, t.lastActivityAt),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contact.tenantId, contact.id] }),
    foreignKey({
      name: "conversation_assignee_membership_fk",
      columns: [t.tenantId, t.assigneeUserId],
      foreignColumns: [membership.tenantId, membership.userId],
    }),
  ],
);

export const message = pgTable(
  "message",
  {
    id: id(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    /** inbound | outbound | note */
    direction: text("direction").notNull(),
    /** sms | email | form | note */
    channel: text("channel").notNull(),
    purpose: text("purpose"),
    body: text("body").notNull(),
    toAddress: text("to_address"),
    /**
     * recorded (inbound/notes) | queued | dispatching | provider_accepted | delivered | failed |
     * suppressed | unknown. Local simulation never reaches "delivered".
     */
    status: text("status").notNull(),
    statusReason: text("status_reason"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    simulated: boolean("simulated").notNull().default(false),
    idempotencyKey: text("idempotency_key"),
    authorUserId: text("author_user_id"),
    workflowRunId: uuid("workflow_run_id"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("message_tenant_id_key").on(t.tenantId, t.id),
    unique("message_idempotency_key").on(t.tenantId, t.idempotencyKey),
    index("message_conversation_idx").on(t.tenantId, t.conversationId, t.createdAt),
    foreignKey({ columns: [t.tenantId, t.conversationId], foreignColumns: [conversation.tenantId, conversation.id] }),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contact.tenantId, contact.id] }),
  ],
);

/** Append-only delivery evidence per message. */
export const messageEvent = pgTable(
  "message_event",
  {
    id: id(),
    tenantId: tenantId(),
    messageId: uuid("message_id").notNull(),
    status: text("status").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    /** True when the status is inferred rather than reported by a provider. */
    inferred: boolean("inferred").notNull().default(false),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("message_event_message_idx").on(t.tenantId, t.messageId),
    foreignKey({ columns: [t.tenantId, t.messageId], foreignColumns: [message.tenantId, message.id] }),
  ],
);

// ---------------------------------------------------------------------------------------------
// Outbox (external effects)
// ---------------------------------------------------------------------------------------------
export const outboxEvent = pgTable(
  "outbox_event",
  {
    id: id(),
    tenantId: tenantId(),
    kind: text("kind").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** pending | done | dead | needs_review */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(4),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: ts("lease_expires_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    unique("outbox_event_tenant_id_key").on(t.tenantId, t.id),
    unique("outbox_event_idempotency_key").on(t.tenantId, t.idempotencyKey),
    index("outbox_event_ready_idx").on(t.status, t.nextAttemptAt),
  ],
);

// ---------------------------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------------------------
export const workflow = pgTable(
  "workflow",
  {
    id: id(),
    tenantId: tenantId().references(() => tenant.id),
    name: text("name").notNull(),
    triggerType: text("trigger_type").notNull(),
    activeVersionId: uuid("active_version_id"),
    paused: boolean("paused").notNull().default(false),
    draftDefinition: jsonb("draft_definition").$type<unknown>().notNull(),
    draftUpdatedAt: ts("draft_updated_at").notNull().defaultNow(),
    draftUpdatedByUserId: text("draft_updated_by_user_id"),
    /** Minimum configuration-history retention in days (policy; payload retention is separate). */
    versionRetentionDays: integer("version_retention_days").notNull().default(400),
    createdAt: createdAt(),
  },
  (t) => [unique("workflow_tenant_id_key").on(t.tenantId, t.id)],
);

/** Immutable published definitions (UPDATE/DELETE blocked by trigger). */
export const workflowVersion = pgTable(
  "workflow_version",
  {
    id: id(),
    tenantId: tenantId(),
    workflowId: uuid("workflow_id").notNull(),
    version: integer("version").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    definition: jsonb("definition").$type<unknown>().notNull(),
    contentHash: text("content_hash").notNull(),
    changeSummary: text("change_summary").notNull(),
    publishedByUserId: text("published_by_user_id").notNull(),
    publishedAt: ts("published_at").notNull().defaultNow(),
  },
  (t) => [
    unique("workflow_version_tenant_id_key").on(t.tenantId, t.id),
    unique("workflow_version_wf_id_key").on(t.tenantId, t.workflowId, t.id),
    unique("workflow_version_number_key").on(t.tenantId, t.workflowId, t.version),
    foreignKey({ columns: [t.tenantId, t.workflowId], foreignColumns: [workflow.tenantId, workflow.id] }),
  ],
);

export const workflowRun = pgTable(
  "workflow_run",
  {
    id: id(),
    tenantId: tenantId(),
    workflowId: uuid("workflow_id").notNull(),
    /** Pinned at creation; never changes. */
    workflowVersionId: uuid("workflow_version_id").notNull(),
    triggerInboxEventId: uuid("trigger_inbox_event_id").notNull(),
    contactId: uuid("contact_id"),
    /** pending | running | waiting | completed | failed | needs_review | cancelled */
    status: text("status").notNull().default("pending"),
    currentStepId: text("current_step_id"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull(),
    wakeAt: ts("wake_at"),
    waitReason: text("wait_reason"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: ts("lease_expires_at"),
    correlationId: text("correlation_id").notNull(),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    unique("workflow_run_tenant_id_key").on(t.tenantId, t.id),
    unique("workflow_run_trigger_key").on(t.tenantId, t.workflowId, t.triggerInboxEventId),
    index("workflow_run_ready_idx").on(t.status, t.wakeAt),
    index("workflow_run_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
    foreignKey({
      name: "workflow_run_version_fk",
      columns: [t.tenantId, t.workflowId, t.workflowVersionId],
      foreignColumns: [workflowVersion.tenantId, workflowVersion.workflowId, workflowVersion.id],
    }),
    foreignKey({ columns: [t.tenantId, t.triggerInboxEventId], foreignColumns: [inboxEvent.tenantId, inboxEvent.id] }),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contact.tenantId, contact.id] }),
  ],
);

export const stepAttempt = pgTable(
  "step_attempt",
  {
    id: id(),
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    stepId: text("step_id").notNull(),
    stepType: text("step_type").notNull(),
    attempt: integer("attempt").notNull(),
    /** succeeded | waiting | failed_retryable | failed_permanent | skipped */
    status: text("status").notNull(),
    workerId: text("worker_id").notNull(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    error: text("error"),
    retryAt: ts("retry_at"),
    startedAt: ts("started_at").notNull(),
    finishedAt: ts("finished_at").notNull().defaultNow(),
  },
  (t) => [
    index("step_attempt_run_idx").on(t.tenantId, t.runId, t.startedAt),
    foreignKey({ columns: [t.tenantId, t.runId], foreignColumns: [workflowRun.tenantId, workflowRun.id] }),
  ],
);

/**
 * Completed-effect ledger: one row per (run, step). Written in the same transaction as the step's
 * business effect, so a retried or replayed step never repeats a completed effect.
 */
export const stepEffect = pgTable(
  "step_effect",
  {
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    stepId: text("step_id").notNull(),
    /** pending (external effect requested, awaiting outcome) | completed */
    state: text("state").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.runId, t.stepId] }),
    foreignKey({ columns: [t.tenantId, t.runId], foreignColumns: [workflowRun.tenantId, workflowRun.id] }),
  ],
);

// ---------------------------------------------------------------------------------------------
// Audit (append-only) and local provider simulation
// ---------------------------------------------------------------------------------------------
export const auditEvent = pgTable(
  "audit_event",
  {
    id: id(),
    tenantId: tenantId(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    /** user | workflow | system | public_form | local_provider */
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    contactId: uuid("contact_id"),
    correlationId: text("correlation_id"),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    index("audit_event_tenant_time_idx").on(t.tenantId, t.occurredAt),
    index("audit_event_contact_idx").on(t.tenantId, t.contactId, t.occurredAt),
    index("audit_event_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  ],
);

/** The local messaging simulator's own store, standing in for an external provider's records. */
export const localSimDelivery = pgTable(
  "local_sim_delivery",
  {
    id: id(),
    tenantId: tenantId(),
    idempotencyKey: text("idempotency_key").notNull(),
    channel: text("channel").notNull(),
    toAddress: text("to_address").notNull(),
    body: text("body").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("local_sim_delivery_key").on(t.tenantId, t.idempotencyKey)],
);

export const localSimAttempt = pgTable(
  "local_sim_attempt",
  {
    id: id(),
    tenantId: tenantId(),
    idempotencyKey: text("idempotency_key").notNull(),
    outcome: text("outcome").notNull(),
    attemptedAt: ts("attempted_at").notNull().defaultNow(),
  },
  (t) => [index("local_sim_attempt_key_idx").on(t.tenantId, t.idempotencyKey)],
);
