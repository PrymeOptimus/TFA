/**
 * A1 — Tenant isolation. User A cannot list, read by guessed id, update, or export tenant B's
 * records, through services and through PostgreSQL RLS with the restricted runtime role.
 * Missing tenant context denies access. (No real-time subscription channel exists in Milestone 1.)
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAppDb, withTenant, withoutContext } from "@/db/client";
import { contact, opportunity } from "@/db/schema";
import { NotFoundError } from "@/server/errors";
import { completeTask, exportCsv, getContact, getTimeline, listContacts, moveOpportunity, resolveActor, getConversation } from "@/server/services/crm";
import { getRun, getWorkflow } from "@/server/services/workflows";
import { actors, expectDbError, q, submit, testEngine, TENANT_A, TENANT_B, TOKEN_B, leadFields } from "../helpers";

let A: Awaited<ReturnType<typeof actors>>;
let b: { contactId: string; oppId: string; taskId: string; runId: string; convId: string; workflowId: string };

beforeAll(async () => {
  A = await actors();
  // Create fresh tenant-B activity through the public path so B has runs/messages too.
  const r = await submit(TOKEN_B, leadFields({ firstName: "Bravo" }));
  if (r.status !== "accepted") throw new Error("setup failed");
  await testEngine().drain();
  const [row] = await q<{ opp: string; task: string; conv: string; wf: string }>(
    TENANT_B,
    sql`select (select id from opportunity where contact_id = ${r.contactId}) opp,
               (select id from task where contact_id = ${r.contactId} limit 1) task,
               (select id from conversation where contact_id = ${r.contactId}) conv,
               (select id from workflow limit 1) wf`,
  );
  b = { contactId: r.contactId, runId: r.runIds[0]!, oppId: row!.opp, taskId: row!.task, convId: row!.conv, workflowId: row!.wf };
});
afterAll(closeAppDb);

describe("A1 service layer", () => {
  it("runs as the restricted runtime role (not owner, no BYPASSRLS)", async () => {
    const r = await withoutContext((tx) =>
      tx.execute<{ u: string; bypass: boolean; super: boolean; owns: number }>(sql`
        select current_user u, r.rolbypassrls bypass, r.rolsuper super,
               (select count(*)::int from pg_tables where schemaname = 'public' and tableowner = current_user) owns
        from pg_roles r where r.rolname = current_user`),
    );
    expect(r.rows[0]).toEqual({ u: "crm_app", bypass: false, super: false, owns: 0 });
  });

  it("lists only the actor's tenant", async () => {
    const list = await listContacts(A.ownerA, { q: "Bravo" });
    expect(list.rows.map((c) => c.id)).not.toContain(b.contactId);
    const all = await listContacts(A.ownerA, { page: 1 });
    const ids = new Set((await q<{ id: string }>(TENANT_A, sql`select id from contact`)).map((r) => r.id));
    expect(all.rows.every((c) => ids.has(c.id))).toBe(true);
  });

  it("cannot read tenant B records by guessed id (404, existence not confirmed)", async () => {
    await expect(getContact(A.ownerA, b.contactId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTimeline(A.ownerA, b.contactId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRun(A.ownerA, b.runId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getConversation(A.ownerA, b.convId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getWorkflow(A.ownerA, b.workflowId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot update tenant B records", async () => {
    const [stageA] = await q<{ id: string }>(TENANT_A, sql`select id from stage limit 1`);
    await expect(moveOpportunity(A.ownerA, b.oppId, stageA!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(completeTask(A.ownerA, b.taskId)).rejects.toBeInstanceOf(NotFoundError);
    const [t] = await q<{ status: string }>(TENANT_B, sql`select status from task where id = ${b.taskId}`);
    expect(t!.status).toBe("open");
  });

  it("exports contain no tenant B data", async () => {
    const { csv } = await exportCsv(A.ownerA, "contacts");
    expect(csv).not.toContain(b.contactId);
    expect(csv).not.toContain("Bravo");
    const { csv: oppCsv } = await exportCsv(A.ownerA, "opportunities");
    expect(oppCsv).not.toContain(b.oppId);
  });

  it("ignores a client-supplied tenant the user is not a member of", async () => {
    const resolved = await resolveActor({ id: A.ownerA.userId, name: "x", email: "x" }, TENANT_B);
    expect(resolved?.tenantId).toBe(TENANT_A);
  });
});

describe("A1 database row-level security (runtime role)", () => {
  it("tenant A context sees zero tenant B rows even when asking for them explicitly", async () => {
    const rows = await q(TENANT_A, sql`select id from contact where tenant_id = ${TENANT_B}`);
    expect(rows).toHaveLength(0);
    const runs = await q(TENANT_A, sql`select id from workflow_run where id = ${b.runId}`);
    expect(runs).toHaveLength(0);
  });

  it("tenant A context cannot update or delete tenant B rows", async () => {
    const r = await withTenant(TENANT_A, null, (tx) => tx.execute(sql`update contact set first_name = 'pwned' where id = ${b.contactId}`));
    expect(r.rowCount).toBe(0);
    const d = await withTenant(TENANT_A, null, (tx) => tx.execute(sql`delete from task where id = ${b.taskId}`));
    expect(d.rowCount).toBe(0);
    const [c] = await q<{ first_name: string }>(TENANT_B, sql`select first_name from contact where id = ${b.contactId}`);
    expect(c!.first_name).toBe("Bravo");
  });

  it("tenant A context cannot insert rows labeled as tenant B (WITH CHECK)", async () => {
    await expectDbError(withTenant(TENANT_A, null, (tx) => tx.insert(contact).values({ tenantId: TENANT_B, displayName: "x", nameNormalized: "x" })),
      /row-level security/,
    );
  });

  it("composite foreign keys reject cross-tenant relationships", async () => {
    const [p] = await q<{ pipeline_id: string; id: string }>(TENANT_A, sql`select pipeline_id, id from stage limit 1`);
    await expectDbError(withTenant(TENANT_A, null, (tx) =>
        tx.insert(opportunity).values({ tenantId: TENANT_A, contactId: b.contactId, pipelineId: p!.pipeline_id, stageId: p!.id, name: "cross-tenant" }),
      ),
      /foreign key/,
    );
  });

  it("missing tenant context denies reads and writes", async () => {
    const r = await withoutContext((tx) => tx.execute<{ n: number }>(sql`select count(*)::int n from contact`));
    expect(r.rows[0]!.n).toBe(0);
    const t = await withoutContext((tx) => tx.execute<{ n: number }>(sql`select count(*)::int n from tenant`));
    expect(t.rows[0]!.n).toBe(0);
    await expectDbError(withoutContext((tx) => tx.insert(contact).values({ tenantId: TENANT_A, displayName: "x", nameNormalized: "x" })), /row-level security/);
  });

  it("tenant context is transaction-local and never leaks across pooled requests", async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const db = drizzle(pool);
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${TENANT_A}, true)`);
        const r = await tx.execute<{ n: number }>(sql`select count(*)::int n from contact`);
        expect(r.rows[0]!.n).toBeGreaterThan(0);
      });
      // Same single pooled connection, next "request":
      const after = await db.execute<{ t: string | null; n: number }>(sql`select current_setting('app.tenant_id', true) t, (select count(*)::int from contact) n`);
      expect(after.rows[0]!.t ?? "").toBe("");
      expect(after.rows[0]!.n).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("the owner role is also subject to RLS (FORCE ROW LEVEL SECURITY)", async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
    try {
      const r = await pool.query("select count(*)::int n from contact");
      expect(r.rows[0].n).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("audit events are append-only for every role", async () => {
    await expectDbError(withTenant(TENANT_A, null, (tx) => tx.execute(sql`update audit_event set summary = 'x'`)), /permission denied|append-only/);
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
    try {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(`select set_config('app.tenant_id', '${TENANT_A}', true)`);
        await expect(c.query("delete from audit_event")).rejects.toThrow(/append-only/);
        await c.query("rollback");
      } finally {
        c.release();
      }
    } finally {
      await pool.end();
    }
  });

  it("queue claim functions return identifiers only and the runtime role cannot assume crm_system", async () => {
    await expectDbError(withoutContext((tx) => tx.execute(sql`set role crm_system`)), /permission denied/);
  });
});
