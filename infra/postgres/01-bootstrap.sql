-- Local development bootstrap ONLY (run as a PostgreSQL superuser).
-- Roles:
--   crm_owner  : owns schema objects and runs migrations/seed. Never used by the web app or worker.
--   crm_app    : runtime login role for web + worker. Owns nothing, NOBYPASSRLS, subject to
--                FORCE ROW LEVEL SECURITY on every tenant table.
--   crm_system : NOLOGIN. Owns only a few SECURITY DEFINER functions that hand out work-queue
--                leases (run/outbox ids) and resolve public form tokens. It is granted narrow
--                table privileges; crm_app can EXECUTE those functions but cannot assume the role.
-- Passwords below are local placeholders. Production credentials come from a secrets manager.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_owner') THEN
    CREATE ROLE crm_owner LOGIN PASSWORD 'crm_owner_local_only' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN PASSWORD 'crm_app_local_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_system') THEN
    CREATE ROLE crm_system NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END $$;
ALTER ROLE crm_owner CREATEDB;
-- crm_owner must be able to SET ROLE crm_system to assign function ownership during migrations.
GRANT crm_system TO crm_owner;
SELECT 'CREATE DATABASE crm_dev OWNER crm_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'crm_dev')\gexec
SELECT 'CREATE DATABASE crm_test OWNER crm_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'crm_test')\gexec
