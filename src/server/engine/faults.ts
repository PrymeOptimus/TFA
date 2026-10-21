/**
 * Test-only fault injection used to prove crash recovery. Active only when APP_ENV=test and
 * CRM_FAULT names the crash point (comma-separated). config.ts rejects CRM_FAULT in production.
 *
 * Crash points:
 *   before_commit:<stepId>  inside a step transaction, before it commits (proves atomic rollback)
 *   after_provider_send     after the provider accepted a message, before the result is recorded
 */
export class SimulatedCrash extends Error {
  constructor(readonly point: string) {
    super(`simulated crash at ${point}`);
  }
}

type Handler = (point: string) => never;
const defaultHandler: Handler = (point) => {
  // Hard kill: no finally blocks, no graceful shutdown, leases left in place.
  process.stderr.write(`[fault-injection] crashing at ${point}\n`);
  process.kill(process.pid, "SIGKILL");
  throw new SimulatedCrash(point);
};
let handler: Handler = defaultHandler;

/** In-process tests replace the hard kill with a thrown SimulatedCrash. */
export function setFaultHandler(h: Handler | null) {
  handler = h ?? defaultHandler;
}

export function maybeCrash(point: string) {
  if (process.env.APP_ENV !== "test") return;
  const spec = process.env.CRM_FAULT;
  if (!spec) return;
  if (spec.split(",").map((s) => s.trim()).includes(point)) handler(point);
}
