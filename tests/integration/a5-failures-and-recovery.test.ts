/**
 * A5 — Force a retryable and a permanent local-provider failure. Verify bounded retries with
 * backoff, clear run state, and auditable operator recovery that never redoes completed actions.
 * Also covers dispatch-policy checks (consent, kill switch, pause) and the ambiguous-outcome path.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeAppDb } from "@/db/client";
import { backoffMs, RETRY_BASE_MS, RETRY_CAP_MS } from "@/server/engine/engine";
import { setFaultHandler, SimulatedCrash } from "@/server/engine/faults";
import { LocalSimulatedProvider } from "@/server/messaging/local";
import type { MessagingProvider } from "@/server/messaging/provider";
import { getToday } from "@/server/services/crm";
import { setSendingPaused } from "@/server/services/settings";
import { retryRun, setWorkflowPaused, skipFailedStep } from "@/server/services/workflows";
import { actors, leadFields, leadWorkflowId, publishVariant, q, runRecords, setWait, submit, testEngine, TENANT_A, TOKEN_A } from "../helpers";

afterAll(closeAppDb);
afterEach(() => {
  setFaultHandler(null);
  delete process.env.CRM_FAULT;
});

async function start(fields: Record<string, unknown>, eng: ReturnType<typeof testEngine>) {
  const r = await submit(TOKEN_A, leadFields(fields), undefined, eng.now());
  if (r.status !== "accepted") throw new Error("expected accepted");
  return r.runIds[0]!;
}

describe("A5 failures, retries and recovery", () => {
  it("backoff is exponential, jittered and capped", () => {
    expect(backoffMs(1, () => 0.5)).toBe(RETRY_BASE_MS);
    expect(backoffMs(3, () => 0.5)).toBe(RETRY_BASE_MS * 4);
    expect(backoffMs(30, () => 0.5)).toBe(RETRY_CAP_MS);
    expect(backoffMs(2, () => 0)).toBe(Math.round(RETRY_BASE_MS * 2 * 0.8));
    expect(backoffMs(2, () => 1)).toBe(Math.round(RETRY_BASE_MS * 2 * 1.2));
  });

  it("a retryable provider failure is retried with backoff, then succeeds exactly once", async () => {
    const { managerA } = await actors();
    await publishVariant(managerA, setWait(30), "A5 base");
    const eng = testEngine();
    const runId = await start({ firstName: "Retry", phone: "(404) 555-0198" }, eng);
    await eng.drain();
    let rec = await runRecords(TENANT_A, runId);
    expect(rec.messages[0]!.status).toBe("queued");
    expect(rec.messages[0]!.status_reason).toMatch(/Retry 2\/4 scheduled/);
    expect(rec.outbox[0]).toMatchObject({ status: "pending", attempts: 1 });

    // Not yet due: nothing happens.
    eng.advance(500);
    await eng.drain();
    expect((await runRecords(TENANT_A, runId)).outbox[0]!.attempts).toBe(1);

    for (let i = 0; i < 3; i++) {
      eng.advance(RETRY_CAP_MS);
      await eng.drain();
    }
    rec = await runRecords(TENANT_A, runId);
    expect(rec.outbox[0]).toMatchObject({ status: "done", attempts: 3 });
    expect(rec.messages[0]!.status).toBe("provider_accepted");
    expect(rec.deliveries).toHaveLength(1);
    const evs = await q<{ status: string }>(TENANT_A, sql`select status from message_event where message_id = ${rec.messages[0]!.id} order by occurred_at`);
    expect(evs.map((e) => e.status)).toEqual(["queued", "attempt_failed_retryable", "attempt_failed_retryable", "provider_accepted"]);
    expect(rec.tasks.filter((t) => t.title.startsWith("Call "))).toHaveLength(1);
    expect(rec.opps).toHaveLength(1);
    expect(rec.run.status).toBe("completed"); // retries + 30 s wait elapsed on the test clock
  });

  it("a permanent failure fails the run clearly, appears in the review queue, and recovers without redoing work", async () => {
    const { managerA } = await actors();
    const eng = testEngine();
    const runId = await start({ firstName: "Permanent", phone: "(404) 555-0199" }, eng);
    await eng.drain();
    let rec = await runRecords(TENANT_A, runId);
    expect(rec.outbox[0]).toMatchObject({ status: "dead", attempts: 1 }); // no retries for permanent errors
    expect(rec.messages[0]!.status).toBe("failed");
    expect(rec.run.status).toBe("failed");
    expect(rec.run.error).toMatch(/Acknowledgment not sent: Local simulator: recipient rejected/);
    expect(rec.run.current_step_id).toBe("acknowledge");

    const today = await getToday(managerA, eng.now());
    expect(today.failed.map((f) => f.id)).toContain(runId);

    // Operator retry: re-queues the send only. It fails permanently again (same recipient).
    await retryRun(managerA, runId);
    eng.advance(2_000); // operator actions are stamped with wall-clock time; move the test clock past it
    await eng.drain();
    rec = await runRecords(TENANT_A, runId);
    expect(rec.run.status).toBe("failed");
    expect(rec.tasks).toHaveLength(1);
    expect(rec.opps).toHaveLength(1);

    // Operator skip with a reason: run continues past the send; completed steps are not repeated.
    await skipFailedStep(managerA, runId, "Called the contact by phone instead");
    eng.advance(2_000);
    await eng.drain();
    eng.advance(31_000);
    await eng.drain();
    rec = await runRecords(TENANT_A, runId);
    expect(rec.run.status).toBe("completed");
    expect(rec.opps).toHaveLength(1);
    expect(rec.tasks.filter((t) => t.title.startsWith("Call "))).toHaveLength(1);
    expect(rec.attempts.filter((a) => a.step_id === "create_opportunity" && a.status === "succeeded")).toHaveLength(1);
    expect(rec.attempts.some((a) => a.step_id === "acknowledge" && a.status === "skipped")).toBe(true);
    const audit = await q<{ action: string }>(TENANT_A, sql`select action from audit_event where entity_id = ${runId} order by occurred_at`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["workflow_run.failed", "workflow_run.retry_requested", "workflow_run.step_skipped", "workflow_run.completed"]));
  });

  it("a send without consent is suppressed at dispatch and the run continues", async () => {
    const eng = testEngine();
    const runId = await start({ firstName: "NoConsent", smsConsent: false }, eng);
    await eng.drain();
    const rec = await runRecords(TENANT_A, runId);
    expect(rec.messages[0]!.status).toBe("suppressed");
    expect(rec.messages[0]!.status_reason).toMatch(/no transactional SMS consent/);
    expect(rec.deliveries).toHaveLength(0);
    expect(rec.run.status).toBe("waiting");
  });

  it("the tenant kill switch and workflow pause hold queued sends until resumed", async () => {
    const { managerA } = await actors();
    const eng = testEngine();
    await setSendingPaused(managerA, true, "test hold");
    const runId = await start({ firstName: "Held" }, eng);
    await eng.drain();
    let rec = await runRecords(TENANT_A, runId);
    expect(rec.messages[0]!.status).toBe("queued");
    expect(rec.messages[0]!.status_reason).toMatch(/sending is paused/);
    expect(rec.deliveries).toHaveLength(0);
    expect(rec.outbox[0]!.attempts).toBe(0);

    await setSendingPaused(managerA, false, "");
    const { id: wfId } = await leadWorkflowId(TENANT_A);
    await setWorkflowPaused(managerA, wfId, true);
    eng.advance(31_000);
    await eng.drain();
    rec = await runRecords(TENANT_A, runId);
    expect(rec.messages[0]!.status_reason).toMatch(/automation is paused/);
    expect(rec.deliveries).toHaveLength(0);

    await setWorkflowPaused(managerA, wfId, false);
    eng.advance(31_000);
    await eng.drain();
    rec = await runRecords(TENANT_A, runId);
    expect(rec.messages[0]!.status).toBe("provider_accepted");
    expect(rec.deliveries).toHaveLength(1);
  });

  it("an interrupted dispatch with a non-idempotent provider becomes 'unknown' and needs review (never blindly resent)", async () => {
    const { managerA } = await actors();
    const local = new LocalSimulatedProvider();
    const nonIdempotent: MessagingProvider = { name: "test-non-idempotent", simulated: true, supportsIdempotentRetry: false, send: (r) => local.send(r) };
    const eng = testEngine({ provider: nonIdempotent, leaseSeconds: 5 });
    const runId = await start({ firstName: "Ambiguous" }, eng);

    process.env.CRM_FAULT = "after_provider_send";
    setFaultHandler((point) => {
      throw new SimulatedCrash(point);
    });
    await expect(eng.drain()).rejects.toBeInstanceOf(SimulatedCrash);
    setFaultHandler(null);
    delete process.env.CRM_FAULT;
    let rec = await runRecords(TENANT_A, runId);
    expect(rec.messages[0]!.status).toBe("dispatching");
    expect(rec.deliveries).toHaveLength(1); // the provider did accept it

    eng.advance(6_000); // lease expires
    await eng.drain();
    rec = await runRecords(TENANT_A, runId);
    expect(rec.messages[0]!.status).toBe("unknown");
    expect(rec.outbox[0]!.status).toBe("needs_review");
    expect(rec.run.status).toBe("needs_review");
    await expect(retryRun(managerA, runId)).rejects.toMatchObject({ status: 409 }); // must acknowledge duplicate risk
    expect(rec.deliveries).toHaveLength(1);
  });
});
