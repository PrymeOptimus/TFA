import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { authUser, workflow, workflowVersion } from "@/db/schema";
import { appDb } from "@/db/client";
import type { Actor, Role } from "@/server/authz";
import { drain, type EngineDeps } from "@/server/engine/engine";
import { LocalSimulatedProvider } from "@/server/messaging/local";
import type { MessagingProvider } from "@/server/messaging/provider";
import { ingestFormSubmission } from "@/server/services/ingest";
import { publishWorkflow, saveDraft } from "@/server/services/workflows";
import type { WorkflowDefinition } from "@/server/workflow/definition";

export const TENANT_A = "a0000000-0000-4000-8000-000000000001";
export const TENANT_B = "b0000000-0000-4000-8000-000000000002";
export const TOKEN_A = "demo-brightline-lead-form-local-token";
export const TOKEN_B = "demo-harbor-lead-form-local-token";

export async function actor(email: string, tenantId: string, role: Role): Promise<Actor> {
  // auth_user is platform-scoped (no RLS), readable by the runtime role.
  const [u] = await appDb().db.select().from(authUser).where(eq(authUser.email, email));
  if (!u) throw new Error(`seed user ${email} missing`);
  return { userId: u.id, tenantId, role, name: u.name, email: u.email };
}

export const actors = async () => ({
  ownerA: await actor("owner@brightline.test", TENANT_A, "owner"),
  managerA: await actor("manager@brightline.test", TENANT_A, "manager"),
  staffA: await actor("frontdesk@brightline.test", TENANT_A, "staff"),
  restrictedA: await actor("restricted@brightline.test", TENANT_A, "restricted_staff"),
  readOnlyA: await actor("readonly@brightline.test", TENANT_A, "read_only"),
  ownerB: await actor("owner@harbor.test", TENANT_B, "owner"),
  staffB: await actor("staff@harbor.test", TENANT_B, "staff"),
});

export function leadFields(over: Partial<Record<string, unknown>> = {}) {
  return { firstName: "Test", lastName: `Lead ${randomUUID().slice(0, 8)}`, email: "", phone: "(404) 555-0142", message: "Synthetic test inquiry", smsConsent: true, ...over };
}

export function submit(token: string, fields: Record<string, unknown>, submissionId = randomUUID(), now?: Date) {
  return ingestFormSubmission({ token, submissionId, fields, attribution: { utm_source: "test" }, ipHash: null, userAgent: "vitest", correlationId: randomUUID(), now });
}

/** Controllable test clock for the engine. */
export function testEngine(opts: { start?: Date; provider?: MessagingProvider; workerId?: string; leaseSeconds?: number } = {}) {
  let t = (opts.start ?? new Date()).getTime();
  const deps: EngineDeps = {
    workerId: opts.workerId ?? `test-${randomUUID().slice(0, 6)}`,
    now: () => new Date(t),
    provider: opts.provider ?? new LocalSimulatedProvider(),
    leaseSeconds: opts.leaseSeconds ?? 30,
  };
  return {
    deps,
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
    drain: () => drain(deps),
  };
}

/** Typed query helper under a tenant context (runtime role). */
export async function q<T = Record<string, unknown>>(tenantId: string, query: ReturnType<typeof sql>): Promise<T[]> {
  const r = await withTenant(tenantId, null, (tx) => tx.execute(query));
  return r.rows as T[];
}

export async function leadWorkflowId(tenantId: string) {
  const [w] = await withTenant(tenantId, null, (tx) => tx.select({ id: workflow.id, def: workflow.draftDefinition }).from(workflow));
  return { id: w!.id, def: w!.def as WorkflowDefinition };
}

/** Saves and publishes a modified copy of the lead workflow; returns the new version. */
export async function publishVariant(a: Actor, mutate: (d: WorkflowDefinition) => void, summary = "test variant") {
  const { id, def } = await leadWorkflowId(a.tenantId);
  const copy = structuredClone(def);
  mutate(copy);
  await saveDraft(a, id, copy);
  try {
    return await publishWorkflow(a, id, `${summary} ${randomUUID().slice(0, 6)}`);
  } catch (e) {
    // Test files run in any order; if an earlier file already published this exact definition,
    // reuse the active version instead of failing.
    if ((e as { status?: number }).status !== 409) throw e;
    const [v] = await withTenant(a.tenantId, null, (tx) =>
      tx.select().from(workflowVersion).where(eq(workflowVersion.id, sql`(select active_version_id from workflow where id = ${id})`)),
    );
    return v!;
  }
}

export const setWait = (seconds: number) => (d: WorkflowDefinition) => {
  const w = d.steps.find((s) => s.type === "wait");
  if (w && w.type === "wait") w.seconds = seconds;
};

export async function runRecords(tenantId: string, runId: string) {
  const [run] = await q<{ status: string; workflow_version_id: string; wait_reason: string | null; wake_at: Date | null; error: string | null; current_step_id: string | null }>(tenantId, sql`select * from workflow_run where id = ${runId}`);
  const tasks = await q<{ id: string; title: string; status: string }>(tenantId, sql`select id, title, status from task where created_by_run_id = ${runId} order by created_at`);
  const opps = await q(tenantId, sql`select id from opportunity where created_by_run_id = ${runId}`);
  const messages = await q<{ id: string; status: string; provider_message_id: string | null; simulated: boolean; idempotency_key: string; status_reason: string | null }>(tenantId, sql`select * from message where workflow_run_id = ${runId}`);
  const deliveries = await q<{ provider_message_id: string }>(tenantId, sql`select provider_message_id from local_sim_delivery where idempotency_key like ${`run:${runId}:%`}`);
  const outbox = await q<{ status: string; attempts: number; lease_owner: string | null }>(tenantId, sql`select * from outbox_event where idempotency_key like ${`run:${runId}:%`}`);
  const attempts = await q<{ step_id: string; status: string; worker_id: string; attempt: number }>(tenantId, sql`select step_id, status, worker_id, attempt from step_attempt where run_id = ${runId} order by started_at, finished_at`);
  return { run: run!, tasks, opps, messages, deliveries, outbox, attempts };
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 20_000, intervalMs = 150): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Asserts a database error, unwrapping Drizzle's "Failed query" wrapper to the Postgres cause. */
export async function expectDbError(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    const text = `${err.message} ${err.cause?.message ?? ""}`;
    if (!re.test(text)) throw new Error(`expected error matching ${re}, got: ${text}`);
    return;
  }
  throw new Error(`expected error matching ${re}, but the operation succeeded`);
}
