CREATE TYPE "public"."channel" AS ENUM('sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."message_purpose" AS ENUM('transactional', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'manager', 'staff', 'restricted_staff', 'read_only');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"contact_id" uuid,
	"correlation_id" text,
	"summary" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"purpose" "message_purpose" NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_event_action" CHECK ("consent_event"."action" in ('granted','revoked'))
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"display_name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"email" text,
	"email_normalized" text,
	"phone" text,
	"phone_e164" text,
	"owner_user_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"assignee_user_id" text,
	"unanswered" boolean DEFAULT false NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "conversation_contact_key" UNIQUE("tenant_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "duplicate_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"candidate_contact_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_suggestion_pair_key" UNIQUE("tenant_id","contact_id","candidate_contact_id")
);
--> statement-breakpoint
CREATE TABLE "form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sms_consent_text" text NOT NULL,
	"marketing_consent_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "form_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "form_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"inbox_event_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"attribution" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_submission_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "form_submission_inbox_key" UNIQUE("tenant_id","inbox_event_id")
);
--> statement-breakpoint
CREATE TABLE "inbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"receive_count" integer DEFAULT 1 NOT NULL,
	"first_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"result" jsonb,
	CONSTRAINT "inbox_event_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "inbox_event_source_key" UNIQUE("tenant_id","source","source_key")
);
--> statement-breakpoint
CREATE TABLE "ingest_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inbox_event_id" uuid,
	"source" text NOT NULL,
	"source_key" text,
	"payload_hash" text,
	"outcome" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"correlation_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_sim_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"outcome" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_sim_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"channel" text NOT NULL,
	"to_address" text NOT NULL,
	"body" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_tenant_user_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "membership_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"purpose" text,
	"body" text NOT NULL,
	"to_address" text,
	"status" text NOT NULL,
	"status_reason" text,
	"provider" text,
	"provider_message_id" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"idempotency_key" text,
	"author_user_id" text,
	"workflow_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "message_idempotency_key" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "message_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb NOT NULL,
	"inferred" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value_cents" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"owner_user_id" text,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "opportunity_currency_iso" CHECK ("opportunity"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 4 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "outbox_event_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "outbox_event_idempotency_key" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "stage_kind" DEFAULT 'open' NOT NULL,
	CONSTRAINT "stage_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stage_tenant_pipeline_id_key" UNIQUE("tenant_id","pipeline_id","id")
);
--> statement-breakpoint
CREATE TABLE "step_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"step_type" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"worker_id" text NOT NULL,
	"output" jsonb,
	"error" text,
	"retry_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_effect" (
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"state" text NOT NULL,
	"result" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "step_effect_tenant_id_run_id_step_id_pk" PRIMARY KEY("tenant_id","run_id","step_id")
);
--> statement-breakpoint
CREATE TABLE "suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"address" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_address_key" UNIQUE("tenant_id","channel","address")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"opportunity_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"assignee_user_id" text,
	"due_at" timestamp with time zone,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"sending_paused" boolean DEFAULT false NOT NULL,
	"sending_paused_reason" text,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"active_version_id" uuid,
	"paused" boolean DEFAULT false NOT NULL,
	"draft_definition" jsonb NOT NULL,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_updated_by_user_id" text,
	"version_retention_days" integer DEFAULT 400 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"trigger_inbox_event_id" uuid NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_step_id" text,
	"context" jsonb NOT NULL,
	"wake_at" timestamp with time zone,
	"wait_reason" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workflow_run_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "workflow_run_trigger_key" UNIQUE("tenant_id","workflow_id","trigger_inbox_event_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"change_summary" text NOT NULL,
	"published_by_user_id" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_version_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "workflow_version_wf_id_key" UNIQUE("tenant_id","workflow_id","id"),
	CONSTRAINT "workflow_version_number_key" UNIQUE("tenant_id","workflow_id","version")
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_tenant_id_contact_id_contact_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contact"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_tenant_id_location_id_location_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."location"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_owner_membership_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."membership"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_tenant_id_contact_id_contact_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contact"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assignee_membership_fk" FOREIGN KEY ("tenant_id","assignee_user_id") REFERENCES "public"."membership"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_suggestion" ADD CONSTRAINT "duplicate_suggestion_tenant_id_contact_id_contact_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contact"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_suggestion" ADD CONSTRAINT "duplicate_suggestion_tenant_id_candidate_contact_id_contact_tenant_id_id_fk" FOREIGN KEY ("tenant_id","candidate_contact_id") REFERENCES "public"."contact"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_tenant_id_form_id_form_tenant_id_id_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."form"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_tenant_id_inbox_event_id_inbox_event_tenant_id_id_fk" FOREIGN KEY ("tenant_id","inbox_event_id") REFERENCES "public"."inbox_event"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_tenant_id_contact_id_contact_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contact"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_attempt" ADD CONSTRAINT "ingest_attempt_tenant_id_inbox_event_id_inbox_event_tenant_id_id_fk" FOREIGN KEY ("tenant_id","inbox_event_id") REFERENCES "public"."inbox_event"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_tenant_id_conversation_id_conversation_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversation"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_tenant_id_contact_id_contact_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contact"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_event" ADD CONSTRAINT "message_event_tenant_id_message_id_message_tenant_id_id_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."message"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_tenant_id_contact_id_contact_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contact"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_stage_in_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id","stage_id") REFERENCES "public"."stage"("tenant_id","pipeline_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_owner_membership_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."membership"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage" ADD CONSTRAINT "stage_tenant_id_pipeline_id_pipeline_tenant_id_id_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipeline"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_tenant_id_run_id_workflow_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."workflow_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_effect" ADD CONSTRAINT "step_effect_tenant_id_run_id_workflow_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."workflow_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_tenant_id_contact_id_contact_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contact"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_tenant_id_opportunity_id_opportunity_tenant_id_id_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunity"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_membership_fk" FOREIGN KEY ("tenant_id","assignee_user_id") REFERENCES "public"."membership"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_version_fk" FOREIGN KEY ("tenant_id","workflow_id","workflow_version_id") REFERENCES "public"."workflow_version"("tenant_id","workflow_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_tenant_id_trigger_inbox_event_id_inbox_event_tenant_id_id_fk" FOREIGN KEY ("tenant_id","trigger_inbox_event_id") REFERENCES "public"."inbox_event"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_tenant_id_contact_id_contact_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contact"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_tenant_id_workflow_id_workflow_tenant_id_id_fk" FOREIGN KEY ("tenant_id","workflow_id") REFERENCES "public"."workflow"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_tenant_time_idx" ON "audit_event" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_contact_idx" ON "audit_event" USING btree ("tenant_id","contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factor_user_idx" ON "auth_two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factor_secret_idx" ON "auth_two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "consent_event_lookup_idx" ON "consent_event" USING btree ("tenant_id","contact_id","channel","purpose","occurred_at");--> statement-breakpoint
CREATE INDEX "contact_tenant_email_idx" ON "contact" USING btree ("tenant_id","email_normalized");--> statement-breakpoint
CREATE INDEX "contact_tenant_phone_idx" ON "contact" USING btree ("tenant_id","phone_e164");--> statement-breakpoint
CREATE INDEX "contact_tenant_created_idx" ON "contact" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_tenant_name_idx" ON "contact" USING btree ("tenant_id","name_normalized");--> statement-breakpoint
CREATE INDEX "conversation_tenant_activity_idx" ON "conversation" USING btree ("tenant_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "ingest_attempt_tenant_key_idx" ON "ingest_attempt" USING btree ("tenant_id","source","source_key");--> statement-breakpoint
CREATE INDEX "ingest_attempt_rate_idx" ON "ingest_attempt" USING btree ("tenant_id","ip_hash","received_at");--> statement-breakpoint
CREATE INDEX "local_sim_attempt_key_idx" ON "local_sim_attempt" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "local_sim_delivery_key" ON "local_sim_delivery" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "message" USING btree ("tenant_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "message_event_message_idx" ON "message_event" USING btree ("tenant_id","message_id");--> statement-breakpoint
CREATE INDEX "opportunity_tenant_stage_idx" ON "opportunity" USING btree ("tenant_id","pipeline_id","stage_id");--> statement-breakpoint
CREATE INDEX "opportunity_tenant_contact_idx" ON "opportunity" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "outbox_event_ready_idx" ON "outbox_event" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "step_attempt_run_idx" ON "step_attempt" USING btree ("tenant_id","run_id","started_at");--> statement-breakpoint
CREATE INDEX "task_tenant_queue_idx" ON "task" USING btree ("tenant_id","status","due_at");--> statement-breakpoint
CREATE INDEX "task_tenant_assignee_idx" ON "task" USING btree ("tenant_id","assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "workflow_run_ready_idx" ON "workflow_run" USING btree ("status","wake_at");--> statement-breakpoint
CREATE INDEX "workflow_run_tenant_status_idx" ON "workflow_run" USING btree ("tenant_id","status","created_at");