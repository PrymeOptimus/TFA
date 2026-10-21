import { and, asc, desc, eq, max } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import {
  authUser,
  contact,
  membership,
  message,
  messageEvent,
  outboxEvent,
  stage,
  stepAttempt,
  stepEffect,
  workflow,
  workflowRun,
  workflowVersion,
} from "@/db/schema";
import { audit, userActor } from "../audit";
import { authorize, type Actor } from "../authz";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { isUuid } from "../util";
import { contentHash } from "../workflow/hash";
import { nextStepId, parseDefinition, validateStructure, type Issue, type WorkflowDefinition } from "../workflow/definition";

function requireUuid(id: string) {
  if (!isUuid(id)) throw new NotFoundError();
}

export async function listWorkflows(actor: Actor) {
  authorize(actor, "workflows.read");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const wfs = await tx.select().from(workflow).orderBy(asc(workflow.name));
    const versions = await tx.select({ workflowId: workflowVersion.workflowId, id: workflowVersion.id, version: workflowVersion.version }).from(workflowVersion);
    return wfs.map((w) => ({
      ...w,
      activeVersion: versions.find((v) => v.id === w.activeVersionId)?.version ?? null,
      versionCount: versions.filter((v) => v.workflowId === w.id).length,
    }));
  });
}

/** Tenant-dependent validation: pipelines/stages exist, assignees are members. */
async function validateReferences(tx: Tx, def: WorkflowDefinition): Promise<Issue[]> {
  const issues: Issue[] = [];
  const stages = await tx.select({ id: stage.id, pipelineId: stage.pipelineId }).from(stage);
  const members = await tx.select({ userId: membership.userId, role: membership.role }).from(membership);
  def.steps.forEach((s, i) => {
    if (s.type === "create_opportunity" && !stages.some((x) => x.id === s.stageId && x.pipelineId === s.pipelineId)) {
      issues.push({ path: `steps.${i}.stageId`, message: "Stage does not belong to the selected pipeline in this business" });
    }
    if (s.type === "create_task") {
      const m = members.find((x) => x.userId === s.assigneeUserId);
      if (!m) issues.push({ path: `steps.${i}.assigneeUserId`, message: "Assignee is not a member of this business" });
      else if (m.role === "read_only") issues.push({ path: `steps.${i}.assigneeUserId`, message: "Read-only members cannot be assigned tasks" });
    }
  });
  return issues;
}

export async function validateDefinition(tx: Tx, raw: unknown): Promise<{ def: WorkflowDefinition | null; issues: Issue[] }> {
  const p = parseDefinition(raw);
  if (!p.ok) return { def: null, issues: p.issues };
  const issues = [...validateStructure(p.def), ...(await validateReferences(tx, p.def))];
  return { def: p.def, issues };
}

export async function getWorkflow(actor: Actor, workflowId: string) {
  authorize(actor, "workflows.read");
  requireUuid(workflowId);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [w] = await tx.select().from(workflow).where(eq(workflow.id, workflowId));
    if (!w) throw new NotFoundError("Automation not found");
    const versions = await tx
      .select({ v: workflowVersion, publishedByName: authUser.name })
      .from(workflowVersion)
      .leftJoin(authUser, eq(authUser.id, workflowVersion.publishedByUserId))
      .where(eq(workflowVersion.workflowId, w.id))
      .orderBy(desc(workflowVersion.version));
    const runs = await tx
      .select({ r: workflowRun, version: workflowVersion.version, contactName: contact.displayName })
      .from(workflowRun)
      .innerJoin(workflowVersion, eq(workflowVersion.id, workflowRun.workflowVersionId))
      .leftJoin(contact, eq(contact.id, workflowRun.contactId))
      .where(eq(workflowRun.workflowId, w.id))
      .orderBy(desc(workflowRun.createdAt))
      .limit(50);
    const { issues } = await validateDefinition(tx, w.draftDefinition);
    const active = versions.find((x) => x.v.id === w.activeVersionId);
    const draftParsed = parseDefinition(w.draftDefinition);
    const draftHash = draftParsed.ok ? contentHash(draftParsed.def) : null;
    return {
      workflow: w,
      versions: versions.map(({ v, publishedByName }) => ({ ...v, publishedByName })),
      runs: runs.map(({ r, version, contactName }) => ({ ...r, version, contactName })),
      draftIssues: issues,
      draftMatchesActive: Boolean(active && draftHash === active.v.contentHash),
    };
  });
}

export async function saveDraft(actor: Actor, workflowId: string, raw: unknown) {
  authorize(actor, "workflows.edit");
  requireUuid(workflowId);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [w] = await tx.select().from(workflow).where(eq(workflow.id, workflowId)).for("update");
    if (!w) throw new NotFoundError("Automation not found");
    const p = parseDefinition(raw);
    if (!p.ok) throw new ValidationError("The draft is not a valid workflow definition", p.issues);
    await tx.update(workflow).set({ draftDefinition: p.def, draftUpdatedAt: new Date(), draftUpdatedByUserId: actor.userId }).where(eq(workflow.id, w.id));
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: "workflow.draft_saved",
      entityType: "workflow",
      entityId: w.id,
      summary: `Draft of "${w.name}" saved (not published; running automations are unaffected)`,
      data: { draftHash: contentHash(p.def) },
    });
    const { issues } = await validateDefinition(tx, p.def);
    return { issues };
  });
}

/**
 * Publishes the current draft as a new immutable version. Existing runs stay pinned to the
 * version they started on; only runs started after this call use the new version.
 */
export async function publishWorkflow(actor: Actor, workflowId: string, changeSummary: string) {
  authorize(actor, "workflows.publish");
  requireUuid(workflowId);
  const summary = (changeSummary ?? "").trim();
  if (summary.length < 3 || summary.length > 500) throw new ValidationError("Describe what changed (3–500 characters)");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [w] = await tx.select().from(workflow).where(eq(workflow.id, workflowId)).for("update");
    if (!w) throw new NotFoundError("Automation not found");
    const { def, issues } = await validateDefinition(tx, w.draftDefinition);
    if (!def || issues.length) throw new ValidationError("Fix validation issues before publishing", issues);
    const hash = contentHash(def);
    const [{ last } = { last: 0 }] = await tx.select({ last: max(workflowVersion.version) }).from(workflowVersion).where(eq(workflowVersion.workflowId, w.id));
    if (w.activeVersionId) {
      const [active] = await tx.select({ hash: workflowVersion.contentHash }).from(workflowVersion).where(eq(workflowVersion.id, w.activeVersionId));
      if (active?.hash === hash) throw new ConflictError("The draft is identical to the active version; nothing to publish");
    }
    const version = (last ?? 0) + 1;
    const [v] = await tx
      .insert(workflowVersion)
      .values({ tenantId: actor.tenantId, workflowId: w.id, version, schemaVersion: def.schemaVersion, definition: def, contentHash: hash, changeSummary: summary, publishedByUserId: actor.userId })
      .returning();
    await tx.update(workflow).set({ activeVersionId: v!.id }).where(eq(workflow.id, w.id));
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: "workflow.published",
      entityType: "workflow",
      entityId: w.id,
      summary: `Published "${w.name}" v${version}: ${summary}`,
      data: { versionId: v!.id, version, contentHash: hash },
    });
    return v!;
  });
}

export async function setWorkflowPaused(actor: Actor, workflowId: string, paused: boolean) {
  authorize(actor, "workflows.operate");
  requireUuid(workflowId);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [w] = await tx.select().from(workflow).where(eq(workflow.id, workflowId)).for("update");
    if (!w) throw new NotFoundError("Automation not found");
    if (w.paused === paused) return;
    await tx.update(workflow).set({ paused }).where(eq(workflow.id, w.id));
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: paused ? "workflow.paused" : "workflow.resumed",
      entityType: "workflow",
      entityId: w.id,
      summary: paused
        ? `Paused "${w.name}": runs stop advancing and queued sends are held`
        : `Resumed "${w.name}": runs and held sends continue`,
    });
  });
}

export async function getRun(actor: Actor, runId: string) {
  authorize(actor, "workflows.read");
  requireUuid(runId);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [row] = await tx
      .select({ r: workflowRun, v: workflowVersion, workflowName: workflow.name, workflowPaused: workflow.paused, contactName: contact.displayName })
      .from(workflowRun)
      .innerJoin(workflowVersion, eq(workflowVersion.id, workflowRun.workflowVersionId))
      .innerJoin(workflow, eq(workflow.id, workflowRun.workflowId))
      .leftJoin(contact, eq(contact.id, workflowRun.contactId))
      .where(eq(workflowRun.id, runId));
    if (!row) throw new NotFoundError("Run not found");
    const attempts = await tx.select().from(stepAttempt).where(eq(stepAttempt.runId, runId)).orderBy(asc(stepAttempt.startedAt), asc(stepAttempt.finishedAt));
    const effects = await tx.select().from(stepEffect).where(eq(stepEffect.runId, runId));
    const msgs = await tx.select().from(message).where(eq(message.workflowRunId, runId));
    const msgEvents = msgs.length ? await tx.select().from(messageEvent).where(eq(messageEvent.messageId, msgs[0]!.id)).orderBy(asc(messageEvent.occurredAt)) : [];
    const outbox = msgs.length ? await tx.select().from(outboxEvent).where(eq(outboxEvent.aggregateId, msgs[0]!.id)) : [];
    const parsed = parseDefinition(row.v.definition);
    return {
      run: row.r,
      version: row.v,
      definition: parsed.ok ? parsed.def : null,
      workflowName: row.workflowName,
      workflowPaused: row.workflowPaused,
      contactName: row.contactName,
      attempts,
      effects,
      messages: msgs,
      messageEvents: msgEvents,
      outbox,
    };
  });
}

/**
 * Operator recovery for a failed or needs-review run. Completed step effects are never redone.
 * For a send whose outcome is unknown, the operator must acknowledge the duplicate-send risk.
 */
export async function retryRun(actor: Actor, runId: string, opts: { acknowledgeDuplicateRisk?: boolean } = {}) {
  authorize(actor, "workflows.operate");
  requireUuid(runId);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [run] = await tx.select().from(workflowRun).where(eq(workflowRun.id, runId)).for("update");
    if (!run) throw new NotFoundError("Run not found");
    if (run.status !== "failed" && run.status !== "needs_review") throw new ConflictError(`Only failed or needs-review runs can be retried (status: ${run.status})`);
    const now = new Date();
    const [effect] = run.currentStepId
      ? await tx.select().from(stepEffect).where(and(eq(stepEffect.runId, run.id), eq(stepEffect.stepId, run.currentStepId)))
      : [];
    let detail = "Retrying the failed step";
    if (effect?.state === "pending" && effect.result.messageId) {
      const messageId = String(effect.result.messageId);
      const [m] = await tx.select().from(message).where(eq(message.id, messageId)).for("update");
      if (m?.status === "unknown" && !opts.acknowledgeDuplicateRisk) {
        throw new ConflictError("The previous send outcome is unknown. Retrying may send a duplicate; confirm to proceed.");
      }
      if (m && (m.status === "failed" || m.status === "unknown")) {
        await tx.update(message).set({ status: "queued", statusReason: `Manual retry requested by ${actor.name}`, updatedAt: now }).where(eq(message.id, m.id));
        await tx.insert(messageEvent).values({ tenantId: actor.tenantId, messageId: m.id, status: "queued", detail: { manualRetryBy: actor.userId }, occurredAt: now });
        await tx.update(outboxEvent).set({ status: "pending", attempts: 0, nextAttemptAt: now, leaseOwner: null, leaseExpiresAt: null, processedAt: null }).where(eq(outboxEvent.aggregateId, m.id));
        detail = "Re-queued the acknowledgment for dispatch (policy is re-checked before sending)";
      }
      await tx.update(workflowRun).set({ status: "waiting", waitReason: "awaiting_dispatch", wakeAt: null, error: null, updatedAt: now }).where(eq(workflowRun.id, run.id));
    } else {
      await tx.update(workflowRun).set({ status: "running", wakeAt: now, error: null, updatedAt: now }).where(eq(workflowRun.id, run.id));
    }
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: "workflow_run.retry_requested",
      entityType: "workflow_run",
      entityId: run.id,
      contactId: run.contactId,
      correlationId: run.correlationId,
      summary: `${detail}; completed steps are not repeated`,
      data: { stepId: run.currentStepId, acknowledgeDuplicateRisk: Boolean(opts.acknowledgeDuplicateRisk) },
    });
  });
}

export async function skipFailedStep(actor: Actor, runId: string, reason: string) {
  authorize(actor, "workflows.operate");
  requireUuid(runId);
  const why = (reason ?? "").trim();
  if (why.length < 3) throw new ValidationError("Give a reason for skipping this step");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [run] = await tx.select().from(workflowRun).where(eq(workflowRun.id, runId)).for("update");
    if (!run) throw new NotFoundError("Run not found");
    if (run.status !== "failed" && run.status !== "needs_review") throw new ConflictError(`Only failed or needs-review runs can skip a step (status: ${run.status})`);
    const [v] = await tx.select().from(workflowVersion).where(eq(workflowVersion.id, run.workflowVersionId));
    const parsed = parseDefinition(v?.definition);
    if (!parsed.ok) throw new ConflictError("Pinned version is invalid");
    const step = parsed.def.steps.find((s) => s.id === run.currentStepId);
    if (!step) throw new ConflictError("Current step not found");
    if (step.type === "branch") throw new ConflictError("Branch steps cannot be skipped; retry instead");
    const now = new Date();
    const result = { skippedByOperator: actor.userId, reason: why };
    await tx
      .insert(stepEffect)
      .values({ tenantId: actor.tenantId, runId: run.id, stepId: step.id, state: "completed", result, updatedAt: now })
      .onConflictDoUpdate({ target: [stepEffect.tenantId, stepEffect.runId, stepEffect.stepId], set: { state: "completed", result, updatedAt: now } });
    await tx.insert(stepAttempt).values({ tenantId: actor.tenantId, runId: run.id, stepId: step.id, stepType: step.type, attempt: 0, status: "skipped", workerId: `user:${actor.userId}`, output: result, startedAt: now, finishedAt: now });
    const next = nextStepId(parsed.def, step);
    await tx
      .update(workflowRun)
      .set(next ? { status: "running", currentStepId: next, wakeAt: now, error: null, updatedAt: now } : { status: "completed", currentStepId: null, completedAt: now, error: null, updatedAt: now })
      .where(eq(workflowRun.id, run.id));
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: "workflow_run.step_skipped",
      entityType: "workflow_run",
      entityId: run.id,
      contactId: run.contactId,
      correlationId: run.correlationId,
      summary: `Skipped step "${step.name ?? step.id}": ${why}`,
      data: { stepId: step.id },
    });
  });
}

export async function listRecentRuns(actor: Actor) {
  authorize(actor, "workflows.read");
  return withTenant(actor.tenantId, actor.userId, (tx) =>
    tx
      .select({ id: workflowRun.id, status: workflowRun.status, createdAt: workflowRun.createdAt, workflowName: workflow.name, version: workflowVersion.version, contactName: contact.displayName, currentStepId: workflowRun.currentStepId, error: workflowRun.error })
      .from(workflowRun)
      .innerJoin(workflow, eq(workflow.id, workflowRun.workflowId))
      .innerJoin(workflowVersion, eq(workflowVersion.id, workflowRun.workflowVersionId))
      .leftJoin(contact, eq(contact.id, workflowRun.contactId))
      .orderBy(desc(workflowRun.createdAt))
      .limit(25),
  );
}
