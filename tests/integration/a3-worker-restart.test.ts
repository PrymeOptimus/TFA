/**
 * A3 — Run the workflow with a real worker process, hard-kill it (SIGKILL) at three points, start
 * a new worker, and complete the run. No lost task and no unintended duplicate send.
 *   1. during a persisted wait (durable timer)
 *   2. after the provider accepted a message but before the result was recorded
 *   3. inside a step transaction before commit (atomic rollback)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeAppDb } from "@/db/client";
import { actors, leadFields, publishVariant, q, runRecords, setWait, submit, TENANT_A, TOKEN_A, waitFor } from "../helpers";

const children = new Set<ChildProcess>();

function startWorker(id: string, extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/worker/main.ts"], {
    env: { ...process.env, WORKER_ID: id, WORKER_POLL_MS: "100", WORKER_LEASE_SECONDS: "2", LOG_LEVEL: "silent", ...extraEnv },
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.add(child);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  return { child, exited, kill: () => child.kill("SIGKILL") };
}

beforeAll(async () => {
  const { managerA } = await actors();
  await publishVariant(managerA, setWait(3), "A3 short wait");
});
afterEach(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  children.clear();
});
afterAll(closeAppDb);

async function newRun(firstName: string) {
  const r = await submit(TOKEN_A, leadFields({ firstName }));
  if (r.status !== "accepted") throw new Error("expected accepted");
  return r.runIds[0]!;
}

describe("A3 worker crash and restart", () => {
  it("survives a hard kill during a persisted wait", async () => {
    const runId = await newRun("Restart");
    const w1 = startWorker("worker-1");
    await waitFor(async () => (await runRecords(TENANT_A, runId)).run.wait_reason === "timer");
    w1.kill();
    const ex = await w1.exited;
    expect(ex.signal).toBe("SIGKILL");

    const mid = await runRecords(TENANT_A, runId);
    expect(mid.run.status).toBe("waiting");
    expect(mid.run.wake_at).not.toBeNull();
    expect(mid.tasks).toHaveLength(1);
    expect(mid.messages[0]!.status).toBe("provider_accepted");
    expect(mid.deliveries).toHaveLength(1);

    // Let the timer elapse with no worker running: nothing advances (no in-memory timers).
    await new Promise((r) => setTimeout(r, 3_500));
    expect((await runRecords(TENANT_A, runId)).run.status).toBe("waiting");

    const w2 = startWorker("worker-2");
    const done = await waitFor(async () => {
      const r = await runRecords(TENANT_A, runId);
      return r.run.status === "completed" ? r : null;
    });
    w2.kill();
    expect(done.tasks.map((t) => t.title)).toEqual(["Call Restart about their web inquiry", "Escalation: Restart has not been called yet"]);
    expect(done.opps).toHaveLength(1);
    expect(done.messages).toHaveLength(1);
    expect(done.deliveries).toHaveLength(1);
    const workers = new Set(done.attempts.map((a) => a.worker_id));
    expect(workers).toEqual(new Set(["worker-1", "worker-2"]));
  });

  it("does not resend when killed after the provider accepted but before recording the result", async () => {
    const runId = await newRun("Interrupted");
    const w1 = startWorker("worker-crashy", { CRM_FAULT: "after_provider_send" });
    const ex = await w1.exited; // the worker SIGKILLs itself at the fault point
    expect(ex.signal).toBe("SIGKILL");

    const mid = await runRecords(TENANT_A, runId);
    expect(mid.messages[0]!.status).toBe("dispatching");
    expect(mid.deliveries).toHaveLength(1);
    expect(mid.outbox[0]!.lease_owner).toBe("worker-crashy");

    const w2 = startWorker("worker-recovery");
    const done = await waitFor(async () => {
      const r = await runRecords(TENANT_A, runId);
      return r.run.status === "completed" ? r : null;
    });
    w2.kill();
    expect(done.deliveries).toHaveLength(1);
    expect(done.messages[0]).toMatchObject({ status: "provider_accepted", provider_message_id: done.deliveries[0]!.provider_message_id });
    const sim = await q<{ outcome: string }>(TENANT_A, sql`select outcome from local_sim_attempt where idempotency_key = ${done.messages[0]!.idempotency_key} order by attempted_at`);
    expect(sim.map((s) => s.outcome)).toEqual(["accepted", "replayed_idempotent"]);
    expect(done.tasks.filter((t) => t.title.startsWith("Call "))).toHaveLength(1);
  });

  it("rolls back a step that was interrupted before commit and performs it exactly once on restart", async () => {
    const runId = await newRun("Rollback");
    const w1 = startWorker("worker-rollback", { CRM_FAULT: "before_commit:call_task" });
    const ex = await w1.exited;
    expect(ex.signal).toBe("SIGKILL");
    const mid = await runRecords(TENANT_A, runId);
    expect(mid.tasks).toHaveLength(0); // the task insert rolled back with the crashed transaction
    expect(mid.run.current_step_id).toBe("call_task");

    const w2 = startWorker("worker-after-rollback");
    const done = await waitFor(async () => {
      const r = await runRecords(TENANT_A, runId);
      return r.run.status === "completed" ? r : null;
    });
    w2.kill();
    expect(done.tasks.filter((t) => t.title.startsWith("Call "))).toHaveLength(1);
    expect(done.opps).toHaveLength(1);
    expect(done.deliveries).toHaveLength(1);
  });
});
