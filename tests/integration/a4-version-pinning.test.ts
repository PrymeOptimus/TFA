/**
 * A4 — Start a run on v1, publish v2, resume: the original run follows v1 and a new run follows v2.
 * Both version identities are recorded, and the database refuses to re-pin a run.
 */
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeAppDb, withTenant } from "@/db/client";
import type { WorkflowDefinition } from "@/server/workflow/definition";
import { actors, expectDbError, leadFields, publishVariant, q, runRecords, submit, testEngine, TENANT_A, TOKEN_A } from "../helpers";

afterAll(closeAppDb);

const variant = (label: string) => (d: WorkflowDefinition) => {
  for (const s of d.steps) {
    if (s.type === "wait") s.seconds = 60;
    if (s.type === "create_task" && s.id === "escalate") s.title = `${label} escalation for {{contact.firstName}}`;
    if (s.type === "send_message") s.body = `${label}: thanks {{contact.firstName}}`;
  }
};

describe("A4 workflow version pinning", () => {
  it("an in-flight run stays on v1 after v2 is published; new runs use v2", async () => {
    const { managerA } = await actors();
    const v1 = await publishVariant(managerA, variant("PIN-V1"), "pin v1");
    const eng = testEngine();

    const r1 = await submit(TOKEN_A, leadFields({ firstName: "Pinned" }), undefined, eng.now());
    if (r1.status !== "accepted") throw new Error("expected accepted");
    await eng.drain();
    const before = await runRecords(TENANT_A, r1.runIds[0]!);
    expect(before.run).toMatchObject({ status: "waiting", wait_reason: "timer", workflow_version_id: v1.id });

    const v2 = await publishVariant(managerA, variant("PIN-V2"), "pin v2");
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.contentHash).not.toBe(v1.contentHash);

    eng.advance(61_000);
    await eng.drain();
    const after = await runRecords(TENANT_A, r1.runIds[0]!);
    expect(after.run.status).toBe("completed");
    expect(after.run.workflow_version_id).toBe(v1.id);
    expect(after.tasks.map((t) => t.title)).toContain("PIN-V1 escalation for Pinned");
    expect(after.tasks.some((t) => t.title.includes("PIN-V2"))).toBe(false);
    expect(after.messages[0]!.status).toBe("provider_accepted");
    const [m1] = await q<{ body: string }>(TENANT_A, sql`select body from message where id = ${after.messages[0]!.id}`);
    expect(m1!.body).toBe("PIN-V1: thanks Pinned");

    const r2 = await submit(TOKEN_A, leadFields({ firstName: "Fresh" }), undefined, eng.now());
    if (r2.status !== "accepted") throw new Error("expected accepted");
    await eng.drain();
    eng.advance(61_000);
    await eng.drain();
    const second = await runRecords(TENANT_A, r2.runIds[0]!);
    expect(second.run).toMatchObject({ status: "completed", workflow_version_id: v2.id });
    expect(second.tasks.map((t) => t.title)).toContain("PIN-V2 escalation for Fresh");

    // Each run's start event records its version identity.
    const starts = await q<{ entity_id: string; data: { version: number; workflowVersionId: string } }>(
      TENANT_A,
      sql`select entity_id, data from audit_event where action = 'workflow_run.started' and entity_id in (${r1.runIds[0]!}, ${r2.runIds[0]!})`,
    );
    expect(Object.fromEntries(starts.map((s) => [s.entity_id, s.data.workflowVersionId]))).toEqual({ [r1.runIds[0]!]: v1.id, [r2.runIds[0]!]: v2.id });
  });

  it("the database blocks editing a published version or re-pinning a run", async () => {
    const [v] = await q<{ id: string }>(TENANT_A, sql`select id from workflow_version limit 1`);
    await expectDbError(withTenant(TENANT_A, null, (tx) => tx.execute(sql`update workflow_version set change_summary = 'rewrite history' where id = ${v!.id}`)), /permission denied|immutable/);
    // A run pinned to an older version (from the previous test) cannot be moved to the newest one.
    const [row] = await q<{ run_id: string; latest: string }>(
      TENANT_A,
      sql`select r.id run_id, (select id from workflow_version v where v.workflow_id = r.workflow_id order by version desc limit 1) latest
          from workflow_run r
          where r.workflow_version_id <> (select id from workflow_version v where v.workflow_id = r.workflow_id order by version desc limit 1)
          limit 1`,
    );
    expect(row).toBeDefined();
    await expectDbError(withTenant(TENANT_A, null, (tx) => tx.execute(sql`update workflow_run set workflow_version_id = ${row!.latest} where id = ${row!.run_id}`)), /pinned/);
  });

  it("publishing an unchanged draft is refused", async () => {
    const { managerA } = await actors();
    const { publishWorkflow } = await import("@/server/services/workflows");
    const { leadWorkflowId } = await import("../helpers");
    const { id } = await leadWorkflowId(TENANT_A);
    await expect(publishWorkflow(managerA, id, "no-op publish")).rejects.toMatchObject({ status: 409 });
  });
});
