/**
 * A6 — A restricted user cannot publish workflows or export protected data by calling the service
 * layer directly (the same functions the API routes call), even though the UI hides the controls.
 * HTTP-level checks of the same rules live in tests/e2e/a15-lead-to-task.spec.ts.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAppDb } from "@/db/client";
import { ForbiddenError } from "@/server/errors";
import { completeTask, createContact, exportCsv, getContact, listContacts } from "@/server/services/crm";
import { changeMemberRole, rotateFormToken, setSendingPaused } from "@/server/services/settings";
import { publishWorkflow, retryRun, saveDraft, setWorkflowPaused } from "@/server/services/workflows";
import { actors, leadWorkflowId, q, TENANT_A } from "../helpers";

let A: Awaited<ReturnType<typeof actors>>;
let wf: Awaited<ReturnType<typeof leadWorkflowId>>;
beforeAll(async () => {
  A = await actors();
  wf = await leadWorkflowId(TENANT_A);
});
afterAll(closeAppDb);

describe("A6 restricted and read-only roles", () => {
  it("restricted staff cannot publish, edit, pause or operate workflows", async () => {
    await expect(publishWorkflow(A.restrictedA, wf.id, "sneaky publish")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveDraft(A.restrictedA, wf.id, wf.def)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setWorkflowPaused(A.restrictedA, wf.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(retryRun(A.restrictedA, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(ForbiddenError);
    const versions = await q(TENANT_A, sql`select id from workflow_version where workflow_id = ${wf.id}`);
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });

  it("staff and read-only users cannot publish either", async () => {
    await expect(publishWorkflow(A.staffA, wf.id, "staff publish")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishWorkflow(A.readOnlyA, wf.id, "ro publish")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("restricted, staff and read-only users cannot export", async () => {
    for (const a of [A.restrictedA, A.staffA, A.readOnlyA]) {
      await expect(exportCsv(a, "contacts")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(exportCsv(a, "opportunities")).rejects.toBeInstanceOf(ForbiddenError);
    }
    const audits = await q(TENANT_A, sql`select id from audit_event where action = 'export.generated' and actor_id in (${A.restrictedA.userId}, ${A.staffA.userId}, ${A.readOnlyA.userId})`);
    expect(audits).toHaveLength(0);
  });

  it("restricted staff see masked contact details", async () => {
    const list = await listContacts(A.restrictedA);
    const withEmail = list.rows.find((c) => c.email);
    expect(withEmail?.masked).toBe(true);
    expect(withEmail?.email).toMatch(/^.•••@/);
    const d = await getContact(A.restrictedA, withEmail!.id);
    expect(d.contact.phone).toMatch(/^•••-•••-\d{4}$/);
  });

  it("restricted staff can only complete their own tasks; read-only cannot complete any", async () => {
    const [other] = await q<{ id: string }>(TENANT_A, sql`select id from task where status = 'open' and assignee_user_id <> ${A.restrictedA.userId} limit 1`);
    await expect(completeTask(A.restrictedA, other!.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(completeTask(A.readOnlyA, other!.id)).rejects.toBeInstanceOf(ForbiddenError);
    const [t] = await q<{ status: string }>(TENANT_A, sql`select status from task where id = ${other!.id}`);
    expect(t!.status).toBe("open");
  });

  it("only owners manage roles; only managers control forms and sending", async () => {
    await expect(changeMemberRole(A.managerA, A.staffA.userId, "owner")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeMemberRole(A.restrictedA, A.restrictedA.userId, "owner")).rejects.toBeInstanceOf(ForbiddenError);
    const [f] = await q<{ id: string }>(TENANT_A, sql`select id from form limit 1`);
    await expect(rotateFormToken(A.staffA, f!.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setSendingPaused(A.staffA, true, "nope")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createContact(A.readOnlyA, { firstName: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("role changes by an owner are audited", async () => {
    await changeMemberRole(A.ownerA, A.readOnlyA.userId, "staff");
    await changeMemberRole(A.ownerA, A.readOnlyA.userId, "read_only");
    const ev = await q(TENANT_A, sql`select id from audit_event where action = 'membership.role_changed'`);
    expect(ev.length).toBeGreaterThanOrEqual(2);
  });
});
