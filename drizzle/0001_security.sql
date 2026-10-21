-- Security layer: grants, row-level security, append-only/immutability triggers, queue functions.
-- Runs as crm_owner. See SECURITY.md for the threat model and role design.

-- ---------------------------------------------------------------------------------------------
-- Tenant context helpers. Context is bound with set_config(..., true) inside a transaction, so a
-- pooled connection can never carry one request's tenant into another. Missing context => NULL,
-- and every policy below compares against NULL => no rows.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO crm_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO crm_system;
--> statement-breakpoint

-- Identity tables are platform-scoped (managed by Better Auth through the runtime role).
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_user, auth_session, auth_account, auth_verification, auth_two_factor TO crm_app;
--> statement-breakpoint

-- Mutable tenant tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  location, membership, contact, duplicate_suggestion, pipeline, stage, opportunity, task, form,
  inbox_event, form_submission, suppression, conversation, message, outbox_event, workflow,
  workflow_run, step_effect, local_sim_delivery
TO crm_app;
--> statement-breakpoint
-- Append-only tenant tables: no UPDATE/DELETE grant (and triggers below block even the owner).
GRANT SELECT, INSERT ON audit_event, ingest_attempt, consent_event, message_event, workflow_version, step_attempt, local_sim_attempt TO crm_app;
--> statement-breakpoint
-- Tenants are created by platform provisioning (owner role), not by the runtime role.
GRANT SELECT, UPDATE ON tenant TO crm_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Row-level security. FORCE applies policies to the table owner as well.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'location','contact','duplicate_suggestion','pipeline','stage','opportunity','task','form',
    'inbox_event','ingest_attempt','form_submission','consent_event','suppression','conversation',
    'message','message_event','outbox_event','workflow','workflow_version','workflow_run',
    'step_attempt','step_effect','audit_event','local_sim_delivery','local_sim_attempt'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;
--> statement-breakpoint

ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE membership FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A signed-in user may list their own memberships (to choose a tenant) before tenant context exists.
CREATE POLICY membership_read ON membership FOR SELECT
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY membership_insert ON membership FOR INSERT WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY membership_update ON membership FOR UPDATE
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY membership_delete ON membership FOR DELETE USING (tenant_id = app_current_tenant());
--> statement-breakpoint

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_read ON tenant FOR SELECT USING (
  id = app_current_tenant()
  OR EXISTS (SELECT 1 FROM membership m WHERE m.tenant_id = tenant.id AND m.user_id = app_current_user())
);
--> statement-breakpoint
CREATE POLICY tenant_update ON tenant FOR UPDATE USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY tenant_insert ON tenant FOR INSERT WITH CHECK (id = app_current_tenant());
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Append-only and immutability guarantees (apply to every role, including the owner).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only/immutable (% blocked)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_event','ingest_attempt','consent_event','message_event','workflow_version','step_attempt','local_sim_attempt'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_reject_mutation()', t || '_append_only', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Run pinning: a run's version can never be changed after creation.
CREATE OR REPLACE FUNCTION app_pin_run_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workflow_version_id IS DISTINCT FROM OLD.workflow_version_id
     OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'workflow_run version is pinned; use an audited migration operation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER workflow_run_pin_version BEFORE UPDATE ON workflow_run FOR EACH ROW EXECUTE FUNCTION app_pin_run_version();
--> statement-breakpoint

-- Active version must belong to the same workflow and tenant.
ALTER TABLE workflow ADD CONSTRAINT workflow_active_version_fk
  FOREIGN KEY (tenant_id, id, active_version_id) REFERENCES workflow_version (tenant_id, workflow_id, id)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Narrow SECURITY DEFINER functions owned by crm_system (NOLOGIN, BYPASSRLS).
-- They return identifiers only; all record access then happens under tenant context as crm_app.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT ON tenant, form, workflow TO crm_system;
--> statement-breakpoint
GRANT SELECT, UPDATE ON workflow_run, outbox_event TO crm_system;
--> statement-breakpoint

-- Transferring ownership requires the new owner to hold CREATE on the schema; revoked again below.
GRANT CREATE ON SCHEMA public TO crm_system;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_public_form(p_token_hash text)
RETURNS TABLE (form_id uuid, tenant_id uuid, form_name text, tenant_name text, active boolean,
               sms_consent_text text, marketing_consent_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.tenant_id, f.name, t.name, f.active, f.sms_consent_text, f.marketing_consent_text
  FROM form f JOIN tenant t ON t.id = f.tenant_id
  WHERE f.token_hash = p_token_hash
$$;
--> statement-breakpoint
ALTER FUNCTION resolve_public_form(text) OWNER TO crm_system;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION engine_claim_runs(p_worker text, p_limit int, p_lease_seconds int, p_now timestamptz)
RETURNS TABLE (run_id uuid, run_tenant_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ready AS (
    SELECT r.id FROM workflow_run r
    JOIN workflow w ON w.tenant_id = r.tenant_id AND w.id = r.workflow_id
    WHERE r.status IN ('pending', 'running', 'waiting')
      AND r.wake_at IS NOT NULL AND r.wake_at <= p_now
      AND (r.lease_expires_at IS NULL OR r.lease_expires_at < p_now)
      AND NOT w.paused
    ORDER BY r.wake_at
    LIMIT p_limit
    FOR UPDATE OF r SKIP LOCKED
  )
  UPDATE workflow_run r
     SET lease_owner = p_worker, lease_expires_at = p_now + make_interval(secs => p_lease_seconds)
    FROM ready WHERE r.id = ready.id
  RETURNING r.id, r.tenant_id
$$;
--> statement-breakpoint
ALTER FUNCTION engine_claim_runs(text, int, int, timestamptz) OWNER TO crm_system;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION engine_claim_outbox(p_worker text, p_limit int, p_lease_seconds int, p_now timestamptz)
RETURNS TABLE (event_id uuid, event_tenant_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ready AS (
    SELECT o.id FROM outbox_event o
    WHERE o.status = 'pending' AND o.next_attempt_at <= p_now
      AND (o.lease_expires_at IS NULL OR o.lease_expires_at < p_now)
    ORDER BY o.next_attempt_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_event o
     SET lease_owner = p_worker, lease_expires_at = p_now + make_interval(secs => p_lease_seconds)
    FROM ready WHERE o.id = ready.id
  RETURNING o.id, o.tenant_id
$$;
--> statement-breakpoint
ALTER FUNCTION engine_claim_outbox(text, int, int, timestamptz) OWNER TO crm_system;
--> statement-breakpoint

REVOKE CREATE ON SCHEMA public FROM crm_system;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_public_form(text), engine_claim_runs(text, int, int, timestamptz),
  engine_claim_outbox(text, int, int, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_public_form(text), engine_claim_runs(text, int, int, timestamptz),
  engine_claim_outbox(text, int, int, timestamptz) TO crm_app;
