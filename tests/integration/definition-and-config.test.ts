/** Publication validation and configuration guards. */
import { describe, expect, it } from "vitest";
import { parseConfig } from "@/server/config";
import { parseDefinition, validateStructure, type WorkflowDefinition } from "@/server/workflow/definition";

const base = (): WorkflowDefinition => ({
  schemaVersion: 1,
  trigger: { type: "form.submitted", formId: null },
  steps: [
    { id: "call", type: "create_task", title: "Call {{contact.firstName}}", assigneeUserId: "u1", dueInMinutes: 15 },
    { id: "wait", type: "wait", seconds: 60 },
    { id: "check", type: "branch", condition: { kind: "task_completed", taskStepId: "call" }, onTrue: "done", onFalse: "escalate" },
    { id: "escalate", type: "create_task", title: "Escalate", assigneeUserId: "u2", dueInMinutes: 30, next: "done" },
    { id: "done", type: "finish" },
  ],
});

describe("workflow definition validation", () => {
  it("accepts the reference workflow", () => {
    expect(validateStructure(base())).toEqual([]);
  });
  it("rejects cycles", () => {
    const d = base();
    (d.steps[3] as { next: string }).next = "wait";
    expect(validateStructure(d).map((i) => i.message).join()).toMatch(/Cycle detected/);
  });
  it("rejects missing references and unreachable steps", () => {
    const d = base();
    (d.steps[2] as { onFalse: string }).onFalse = "nowhere";
    expect(validateStructure(d).map((i) => i.message).join()).toMatch(/missing step "nowhere"/);
    const e = base();
    (e.steps[2] as { onFalse: string }).onFalse = "done";
    expect(validateStructure(e).map((i) => i.message).join()).toMatch(/"escalate" is unreachable/);
  });
  it("rejects unknown template variables and unsupported node types", () => {
    const d = base();
    (d.steps[0] as { title: string }).title = "Call {{contact.ssn}}";
    expect(validateStructure(d)[0]!.message).toMatch(/Unknown template variable/);
    const p = parseDefinition({ ...base(), steps: [{ id: "x", type: "run_code", code: "rm -rf /" }] });
    expect(p.ok).toBe(false);
  });
  it("rejects a task-completed condition on a task that may not have run", () => {
    const d = base();
    d.steps.splice(0, 0, { id: "first", type: "branch", condition: { kind: "contact_has_phone" }, onTrue: "call", onFalse: "wait" });
    expect(validateStructure(d).map((i) => i.message).join()).toMatch(/does not always run before/);
  });
  it("rejects marketing purpose in Milestone 1", () => {
    const p = parseDefinition({ ...base(), steps: [{ id: "m", type: "send_message", channel: "sms", purpose: "marketing", body: "hi" }] });
    expect(p.ok).toBe(false);
  });
});

describe("configuration guards", () => {
  const env = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "x".repeat(32), IP_HASH_SALT: "saltsalt" };
  it("rejects the local simulation adapter in production", () => {
    expect(() => parseConfig({ ...env, APP_ENV: "production", MESSAGING_PROVIDER: "local" })).toThrow(/not permitted when APP_ENV=production/);
  });
  it("rejects fault injection in production", () => {
    expect(() => parseConfig({ ...env, APP_ENV: "production", CRM_FAULT: "after_provider_send" })).toThrow();
  });
  it("accepts the local adapter in development", () => {
    expect(parseConfig({ ...env, APP_ENV: "development" }).MESSAGING_PROVIDER).toBe("local");
  });
});
