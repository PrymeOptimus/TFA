import { readFileSync, rmSync } from "node:fs";

export default function globalTeardown() {
  try {
    const pid = Number(readFileSync(".tmp/e2e-worker.pid", "utf8"));
    if (pid) process.kill(pid, "SIGTERM");
    rmSync(".tmp/e2e-worker.pid");
  } catch {
    // worker already gone
  }
}
