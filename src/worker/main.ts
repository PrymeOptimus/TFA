import { hostname } from "node:os";
import { loadEnv } from "../../scripts/env";

loadEnv();

const { config } = await import("../server/config");
const { runEngineOnce } = await import("../server/engine/engine");
const { messagingProvider } = await import("../server/messaging/local");
const { log } = await import("../server/log");
const { closeAppDb } = await import("../db/client");

/**
 * Worker process: polls the durable run queue and the outbox. Safe to run several instances; safe
 * to kill at any point (leases expire and another worker resumes from persisted state).
 */
const cfg = config(); // throws if configuration is invalid (e.g. local adapter in production)
const workerId = process.env.WORKER_ID ?? `${hostname()}:${process.pid}`;
const provider = messagingProvider();
let stopping = false;

log.info({ workerId, provider: provider.name, simulated: provider.simulated, appEnv: cfg.APP_ENV }, "worker started");
if (provider.simulated) log.warn("messaging adapter is LOCAL SIMULATION: no real SMS or email will be sent");

const shutdown = (sig: string) => {
  log.info({ sig }, "worker stopping after current pass");
  stopping = true;
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

while (!stopping) {
  try {
    const r = await runEngineOnce({ workerId, now: () => new Date(), provider, leaseSeconds: cfg.WORKER_LEASE_SECONDS });
    if (r.runs || r.outbox) log.debug(r, "worker pass");
  } catch (e) {
    log.error({ err: (e as Error).message }, "worker pass failed");
  }
  await new Promise((r) => setTimeout(r, cfg.WORKER_POLL_MS));
}
await closeAppDb();
log.info("worker stopped");
