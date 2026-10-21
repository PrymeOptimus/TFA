import { and, count, desc, eq, sql } from "drizzle-orm";
import { withTenant, withoutContext, type Tx } from "@/db/client";
import {
  consentEvent,
  contact,
  conversation,
  membership,
  message,
  messageEvent,
  opportunity,
  outboxEvent,
  stage,
  stepAttempt,
  stepEffect,
  suppression,
  task,
  tenant,
  workflow,
  workflowRun,
  workflowVersion,
} from "@/db/schema";
import { audit, type AuditActor } from "../audit";
import { log } from "../log";
import type { MessagingProvider } from "../messaging/provider";
import { span } from "../telemetry";
import { nextStepId, parseDefinition, renderTemplate, type Step, type WorkflowDefinition } from "../workflow/definition";
import { maybeCrash, SimulatedCrash } from "./faults";

/**
 * Durable workflow runtime on PostgreSQL (see DECISIONS.md, ADR-002).
 *
 * - Runs and timers are rows (workflow_run.wake_at). Nothing lives only in worker memory.
 * - Workers take time-bounded leases through SECURITY DEFINER claim functions; a crashed worker's
 *   lease expires and another worker resumes the run from its persisted current step.
 * - Each step executes in one transaction together with its step_effect row, so a database effect
 *   (opportunity, task) either commits once with its ledger entry or not at all.
 * - External effects go through the transactional outbox and a provider idempotency key.
 * - A run executes the definition of the exact version it was created with (pinned by trigger).
 */
export interface EngineDeps {
  workerId: string;
  now: () => Date;
  provider: MessagingProvider;
  leaseSeconds: number;
  /** Max step executions per claimed run per pass (bounds a single pass; graphs are acyclic). */
  maxStepsPerPass?: number;
}

export const MAX_STEP_ATTEMPTS = 3;
export const RETRY_BASE_MS = 2_000;
export const RETRY_CAP_MS = 5 * 60_000;

/** Exponential backoff with ±20% jitter. */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const raw = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.8 + rand() * 0.4));
}

class StepError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

type StepOutcome =
  | { kind: "advance"; next: string | null; output: Record<string, unknown> }
  | { kind: "wait"; wakeAt: Date | null; reason: string; output: Record<string, unknown> }
  | { kind: "fail"; error: string; output?: Record<string, unknown> }
  | { kind: "review"; error: string };

type RunRow = typeof workflowRun.$inferSelect;

interface StepCtx {
  tx: Tx;
  run: RunRow;
  def: WorkflowDefinition;
  step: Step;
  version: number;
  workflowName: string;
  effect: typeof stepEffect.$inferSelect | undefined;
  now: Date;
  actor: AuditActor;
}

const TERMINAL = new Set(["completed", "failed", "needs_review", "cancelled"]);

// ----------------------------------------------------------------------------------------------
// Polling entry points
// ----------------------------------------------------------------------------------------------
export async function runEngineOnce(deps: EngineDeps): Promise<{ runs: number; outbox: number }> {
  const now = deps.now();
  const outbox = await withoutContext((tx) =>
    tx.execute<{ event_id: string; event_tenant_id: string }>(
      sql`select * from engine_claim_outbox(${deps.workerId}, 20, ${deps.leaseSeconds}, ${now.toISOString()}::timestamptz)`,
    ),
  );
  for (const r of outbox.rows) await processOutboxEvent(deps, r.event_id, r.event_tenant_id);

  const runs = await withoutContext((tx) =>
    tx.execute<{ run_id: string; run_tenant_id: string }>(
      sql`select * from engine_claim_runs(${deps.workerId}, 20, ${deps.leaseSeconds}, ${deps.now().toISOString()}::timestamptz)`,
    ),
  );
  for (const r of runs.rows) await processRun(deps, r.run_id, r.run_tenant_id);
  return { runs: runs.rows.length, outbox: outbox.rows.length };
}

/** Repeats passes until no work is ready (used by tests and the demo "drain" helper). */
export async function drain(deps: EngineDeps, maxPasses = 50) {
  for (let i = 0; i < maxPasses; i++) {
    const r = await runEngineOnce(deps);
    if (r.runs === 0 && r.outbox === 0) return;
  }
}

// ----------------------------------------------------------------------------------------------
// Runs
// ----------------------------------------------------------------------------------------------
export async function processRun(deps: EngineDeps, runId: string, tenantId: string): Promise<void> {
  const max = deps.maxStepsPerPass ?? 25;
  for (let i = 0; i < max; i++) {
    const cont = await span("workflow.step", { runId, tenantId }, () => executeCurrentStep(deps, runId, tenantId));
    if (!cont) return;
  }
}

/** Executes one step. Returns true if the run can continue immediately. */
async function executeCurrentStep(deps: EngineDeps, runId: string, tenantId: string): Promise<boolean> {
  const now = deps.now();
  type StepInfo = { stepId: string; stepType: string; attempt: number; correlationId: string };
  const info: { current: StepInfo | null } = { current: null };
  try {
    return await withTenant(tenantId, null, async (tx) => {
      const [run] = await tx.select().from(workflowRun).where(eq(workflowRun.id, runId)).for("update");
      if (!run || run.leaseOwner !== deps.workerId || TERMINAL.has(run.status)) return false;
      const [ver] = await tx
        .select({ definition: workflowVersion.definition, version: workflowVersion.version, name: workflow.name })
        .from(workflowVersion)
        .innerJoin(workflow, and(eq(workflow.tenantId, workflowVersion.tenantId), eq(workflow.id, workflowVersion.workflowId)))
        .where(eq(workflowVersion.id, run.workflowVersionId));
      const parsed = parseDefinition(ver?.definition);
      if (!ver || !parsed.ok) throw new StepError("Pinned workflow version is missing or invalid", true);
      const def = parsed.def;
      const step = def.steps.find((s) => s.id === run.currentStepId);
      if (!step) throw new StepError(`Step "${run.currentStepId}" not found in v${ver.version}`, true);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(stepAttempt)
        .where(and(eq(stepAttempt.runId, run.id), eq(stepAttempt.stepId, step.id), sql`${stepAttempt.status} like 'failed%'`));
      info.current = { stepId: step.id, stepType: step.type, attempt: n + 1, correlationId: run.correlationId };
      const [effect] = await tx
        .select()
        .from(stepEffect)
        .where(and(eq(stepEffect.runId, run.id), eq(stepEffect.stepId, step.id)));
      const actor: AuditActor = { type: "workflow", id: run.workflowId, name: `${ver.name} v${ver.version}` };
      const ctx: StepCtx = { tx, run, def, step, version: ver.version, workflowName: ver.name, effect, now, actor };
      const outcome = await HANDLERS[step.type](ctx);
      return applyOutcome(ctx, deps, outcome, n + 1);
    });
  } catch (e) {
    if (e instanceof SimulatedCrash) throw e;
    // The step's transaction rolled back: no partial effect exists. Record the failure separately.
    const err = e instanceof Error ? e : new Error(String(e));
    const permanent = e instanceof StepError && e.permanent;
    log.warn({ runId, tenantId, err: err.message, permanent }, "workflow step failed");
    await recordStepFailure(deps, runId, tenantId, info.current, err.message, permanent, now);
    return false;
  }
}

async function applyOutcome(ctx: StepCtx, deps: EngineDeps, o: StepOutcome, attempt: number): Promise<boolean> {
  const { tx, run, step, now } = ctx;
  const baseAttempt = {
    tenantId: run.tenantId,
    runId: run.id,
    stepId: step.id,
    stepType: step.type,
    attempt,
    workerId: deps.workerId,
    startedAt: now,
    finishedAt: now,
  };
  if (o.kind === "advance") {
    await tx.insert(stepAttempt).values({ ...baseAttempt, status: "succeeded", output: o.output });
    if (o.next === null) {
      await tx
        .update(workflowRun)
        .set({ status: "completed", currentStepId: null, wakeAt: null, waitReason: null, leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now, error: null })
        .where(eq(workflowRun.id, run.id));
      await audit(tx, {
        tenantId: run.tenantId,
        actor: ctx.actor,
        action: "workflow_run.completed",
        entityType: "workflow_run",
        entityId: run.id,
        contactId: run.contactId,
        correlationId: run.correlationId,
        summary: `Automation "${ctx.workflowName}" v${ctx.version} completed`,
        at: now,
      });
      return false;
    }
    await tx
      .update(workflowRun)
      .set({
        status: "running",
        currentStepId: o.next,
        wakeAt: now,
        waitReason: null,
        updatedAt: now,
        leaseExpiresAt: new Date(now.getTime() + deps.leaseSeconds * 1000),
      })
      .where(eq(workflowRun.id, run.id));
    maybeCrash(`before_commit:${step.id}`);
    return true;
  }
  if (o.kind === "wait") {
    await tx.insert(stepAttempt).values({ ...baseAttempt, status: "waiting", output: o.output });
    await tx
      .update(workflowRun)
      .set({ status: "waiting", wakeAt: o.wakeAt, waitReason: o.reason, leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
      .where(eq(workflowRun.id, run.id));
    return false;
  }
  // fail / review: terminal until an operator acts (retry or skip from the run page).
  await tx.insert(stepAttempt).values({ ...baseAttempt, status: o.kind === "fail" ? "failed_permanent" : "needs_review", output: o.kind === "fail" ? o.output ?? {} : {}, error: o.error });
  const status = o.kind === "fail" ? "failed" : "needs_review";
  await tx
    .update(workflowRun)
    .set({ status, error: o.error, wakeAt: null, waitReason: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
    .where(eq(workflowRun.id, run.id));
  await audit(tx, {
    tenantId: run.tenantId,
    actor: ctx.actor,
    action: o.kind === "fail" ? "workflow_run.failed" : "workflow_run.needs_review",
    entityType: "workflow_run",
    entityId: run.id,
    contactId: run.contactId,
    correlationId: run.correlationId,
    summary: `Automation "${ctx.workflowName}" ${o.kind === "fail" ? "failed" : "needs review"} at step "${step.name ?? step.id}": ${o.error}`,
    data: { stepId: step.id },
    at: now,
  });
  return false;
}

async function recordStepFailure(
  deps: EngineDeps,
  runId: string,
  tenantId: string,
  info: { stepId: string; stepType: string; attempt: number; correlationId: string } | null,
  error: string,
  permanent: boolean,
  now: Date,
) {
  await withTenant(tenantId, null, async (tx) => {
    const [run] = await tx.select().from(workflowRun).where(eq(workflowRun.id, runId)).for("update");
    if (!run || run.leaseOwner !== deps.workerId) return;
    const stepId = info?.stepId ?? run.currentStepId ?? "unknown";
    const attempt = info?.attempt ?? 1;
    const giveUp = permanent || attempt >= MAX_STEP_ATTEMPTS;
    const retryAt = giveUp ? null : new Date(now.getTime() + backoffMs(attempt));
    await tx.insert(stepAttempt).values({
      tenantId,
      runId,
      stepId,
      stepType: info?.stepType ?? "unknown",
      attempt,
      status: giveUp ? "failed_permanent" : "failed_retryable",
      workerId: deps.workerId,
      error,
      retryAt,
      startedAt: now,
      finishedAt: now,
    });
    await tx
      .update(workflowRun)
      .set(
        giveUp
          ? { status: "failed", error, wakeAt: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now }
          : { status: "running", error, wakeAt: retryAt, leaseOwner: null, leaseExpiresAt: null, updatedAt: now },
      )
      .where(eq(workflowRun.id, runId));
    await audit(tx, {
      tenantId,
      actor: { type: "workflow", id: run.workflowId },
      action: giveUp ? "workflow_run.failed" : "workflow_step.retry_scheduled",
      entityType: "workflow_run",
      entityId: runId,
      contactId: run.contactId,
      correlationId: run.correlationId,
      summary: giveUp
        ? `Automation failed at step "${stepId}" after ${attempt} attempt(s): ${error}`
        : `Step "${stepId}" failed (attempt ${attempt}/${MAX_STEP_ATTEMPTS}); retry scheduled`,
      data: { stepId, attempt, retryAt: retryAt?.toISOString() ?? null },
      at: now,
    });
  });
}

// ----------------------------------------------------------------------------------------------
// Step handlers
// ----------------------------------------------------------------------------------------------
async function templateVars(ctx: StepCtx): Promise<Record<string, string>> {
  const [c] = await ctx.tx.select().from(contact).where(eq(contact.id, ctx.run.contactId!));
  return {
    "contact.firstName": c?.firstName ?? "",
    "contact.lastName": c?.lastName ?? "",
    "contact.displayName": c?.displayName ?? "",
    "business.name": String(ctx.run.context.businessName ?? ""),
    "submission.message": String(ctx.run.context.submissionMessage ?? ""),
  };
}

async function completeEffect(ctx: StepCtx, result: Record<string, unknown>) {
  await ctx.tx
    .insert(stepEffect)
    .values({ tenantId: ctx.run.tenantId, runId: ctx.run.id, stepId: ctx.step.id, state: "completed", result, updatedAt: ctx.now })
    .onConflictDoUpdate({ target: [stepEffect.tenantId, stepEffect.runId, stepEffect.stepId], set: { state: "completed", result, updatedAt: ctx.now } });
}

async function mergeContext(ctx: StepCtx, patch: Record<string, unknown>) {
  await ctx.tx
    .update(workflowRun)
    .set({ context: sql`${workflowRun.context} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(workflowRun.id, ctx.run.id));
  Object.assign(ctx.run.context, patch);
}

const advance = (ctx: StepCtx, output: Record<string, unknown>): StepOutcome => ({ kind: "advance", next: nextStepId(ctx.def, ctx.step), output });

type Handler = (ctx: StepCtx) => Promise<StepOutcome>;

const HANDLERS: Record<Step["type"], Handler> = {
  async create_opportunity(ctx) {
    const s = ctx.step as Extract<Step, { type: "create_opportunity" }>;
    if (ctx.effect?.state === "completed") return advance(ctx, { ...ctx.effect.result, reusedEffect: true });
    const [st] = await ctx.tx
      .select({ id: stage.id, name: stage.name })
      .from(stage)
      .where(and(eq(stage.id, s.stageId), eq(stage.pipelineId, s.pipelineId)));
    if (!st) throw new StepError("Configured pipeline stage no longer exists", true);
    const title = renderTemplate(s.title, await templateVars(ctx));
    const [opp] = await ctx.tx
      .insert(opportunity)
      .values({
        tenantId: ctx.run.tenantId,
        contactId: ctx.run.contactId!,
        pipelineId: s.pipelineId,
        stageId: s.stageId,
        name: title,
        valueCents: s.valueCents ?? null,
        createdByRunId: ctx.run.id,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning({ id: opportunity.id });
    await completeEffect(ctx, { opportunityId: opp!.id });
    await mergeContext(ctx, { opportunityId: opp!.id });
    await audit(ctx.tx, {
      tenantId: ctx.run.tenantId,
      actor: ctx.actor,
      action: "opportunity.created",
      entityType: "opportunity",
      entityId: opp!.id,
      contactId: ctx.run.contactId,
      correlationId: ctx.run.correlationId,
      summary: `Opportunity "${title}" created in stage "${st.name}"`,
      data: { runId: ctx.run.id, stepId: s.id, stageId: s.stageId },
      at: ctx.now,
    });
    return advance(ctx, { opportunityId: opp!.id });
  },

  async create_task(ctx) {
    const s = ctx.step as Extract<Step, { type: "create_task" }>;
    if (ctx.effect?.state === "completed") return advance(ctx, { ...ctx.effect.result, reusedEffect: true });
    const [m] = await ctx.tx.select({ userId: membership.userId }).from(membership).where(and(eq(membership.tenantId, ctx.run.tenantId), eq(membership.userId, s.assigneeUserId)));
    if (!m) throw new StepError("Configured assignee is no longer a member of this business", true);
    const vars = await templateVars(ctx);
    const title = renderTemplate(s.title, vars);
    const dueAt = new Date(ctx.now.getTime() + s.dueInMinutes * 60_000);
    const [t] = await ctx.tx
      .insert(task)
      .values({
        tenantId: ctx.run.tenantId,
        contactId: ctx.run.contactId,
        opportunityId: (ctx.run.context.opportunityId as string | undefined) ?? null,
        title,
        description: s.description ? renderTemplate(s.description, vars) : null,
        assigneeUserId: s.assigneeUserId,
        dueAt,
        createdByRunId: ctx.run.id,
        createdAt: ctx.now,
      })
      .returning({ id: task.id });
    await completeEffect(ctx, { taskId: t!.id });
    const tasks = { ...((ctx.run.context.tasks as Record<string, string>) ?? {}), [s.id]: t!.id };
    await mergeContext(ctx, { tasks });
    await audit(ctx.tx, {
      tenantId: ctx.run.tenantId,
      actor: ctx.actor,
      action: "task.created",
      entityType: "task",
      entityId: t!.id,
      contactId: ctx.run.contactId,
      correlationId: ctx.run.correlationId,
      summary: `Task "${title}" assigned, due ${fmtLocal(ctx, dueAt)}`,
      data: { runId: ctx.run.id, stepId: s.id, assigneeUserId: s.assigneeUserId, dueAt: dueAt.toISOString() },
      at: ctx.now,
    });
    return advance(ctx, { taskId: t!.id });
  },

  async wait(ctx) {
    const s = ctx.step as Extract<Step, { type: "wait" }>;
    if (ctx.effect?.state === "completed") return advance(ctx, { ...ctx.effect.result, reusedEffect: true });
    if (!ctx.effect) {
      const wakeAt = new Date(ctx.now.getTime() + s.seconds * 1000);
      await ctx.tx.insert(stepEffect).values({ tenantId: ctx.run.tenantId, runId: ctx.run.id, stepId: s.id, state: "pending", result: { wakeAt: wakeAt.toISOString() }, updatedAt: ctx.now });
      await audit(ctx.tx, {
        tenantId: ctx.run.tenantId,
        actor: ctx.actor,
        action: "workflow_run.waiting",
        entityType: "workflow_run",
        entityId: ctx.run.id,
        contactId: ctx.run.contactId,
        correlationId: ctx.run.correlationId,
        summary: `Automation waiting ${formatSeconds(s.seconds)} (until ${fmtLocal(ctx, wakeAt)})`,
        data: { stepId: s.id, wakeAt: wakeAt.toISOString() },
        at: ctx.now,
      });
      return { kind: "wait", wakeAt, reason: "timer", output: { wakeAt: wakeAt.toISOString() } };
    }
    const wakeAt = new Date(String(ctx.effect.result.wakeAt));
    if (ctx.now < wakeAt) return { kind: "wait", wakeAt, reason: "timer", output: { wakeAt: wakeAt.toISOString(), early: true } };
    await completeEffect(ctx, { wakeAt: wakeAt.toISOString(), resumedAt: ctx.now.toISOString() });
    return advance(ctx, { wakeAt: wakeAt.toISOString(), resumedAt: ctx.now.toISOString() });
  },

  async branch(ctx) {
    const s = ctx.step as Extract<Step, { type: "branch" }>;
    // Branch results are recorded once, so a replay follows the same path.
    if (ctx.effect?.state === "completed") {
      const r = Boolean(ctx.effect.result.value);
      return { kind: "advance", next: r ? s.onTrue : s.onFalse, output: { ...ctx.effect.result, reusedEffect: true } };
    }
    let value = false;
    let detail = "";
    if (s.condition.kind === "task_completed") {
      const taskId = (ctx.run.context.tasks as Record<string, string> | undefined)?.[s.condition.taskStepId];
      const [t] = taskId ? await ctx.tx.select({ status: task.status }).from(task).where(eq(task.id, taskId)) : [];
      value = t?.status === "completed";
      detail = `task ${t?.status ?? "missing"}`;
    } else {
      const [c] = await ctx.tx.select().from(contact).where(eq(contact.id, ctx.run.contactId!));
      value = s.condition.kind === "contact_has_phone" ? Boolean(c?.phoneE164) : Boolean(c?.emailNormalized);
      detail = s.condition.kind;
    }
    await completeEffect(ctx, { value, detail });
    return { kind: "advance", next: value ? s.onTrue : s.onFalse, output: { value, detail } };
  },

  async send_message(ctx) {
    const s = ctx.step as Extract<Step, { type: "send_message" }>;
    if (ctx.effect?.state === "completed") return advance(ctx, { ...ctx.effect.result, reusedEffect: true });
    if (ctx.effect?.state === "pending") {
      const messageId = String(ctx.effect.result.messageId);
      const [m] = await ctx.tx.select().from(message).where(eq(message.id, messageId));
      if (!m) throw new StepError("Queued message record is missing", true);
      if (m.status === "provider_accepted" || m.status === "delivered" || m.status === "suppressed") {
        const out = { messageId, outcome: m.status, simulated: m.simulated, reason: m.statusReason };
        await completeEffect(ctx, out);
        return advance(ctx, out);
      }
      if (m.status === "failed") return { kind: "fail", error: `Acknowledgment not sent: ${m.statusReason ?? "provider failure"}`, output: { messageId } };
      if (m.status === "unknown") return { kind: "review", error: `Send outcome unknown: ${m.statusReason ?? "interrupted dispatch"}. Review before any resend.` };
      return { kind: "wait", wakeAt: null, reason: "awaiting_dispatch", output: { messageId, status: m.status } };
    }

    // First execution: create the message and outbox event in this transaction (transactional outbox).
    const [c] = await ctx.tx.select().from(contact).where(eq(contact.id, ctx.run.contactId!));
    const to = s.channel === "sms" ? c?.phoneE164 : c?.emailNormalized;
    const vars = await templateVars(ctx);
    const body = renderTemplate(s.body, vars);
    const [conv] = await ctx.tx
      .insert(conversation)
      .values({ tenantId: ctx.run.tenantId, contactId: ctx.run.contactId!, lastActivityAt: ctx.now })
      .onConflictDoUpdate({ target: [conversation.tenantId, conversation.contactId], set: { lastActivityAt: ctx.now } })
      .returning({ id: conversation.id });
    const idempotencyKey = `run:${ctx.run.id}:step:${s.id}`;
    const noAddress = !to;
    const [m] = await ctx.tx
      .insert(message)
      .values({
        tenantId: ctx.run.tenantId,
        conversationId: conv!.id,
        contactId: ctx.run.contactId!,
        direction: "outbound",
        channel: s.channel,
        purpose: s.purpose,
        body,
        toAddress: to ?? null,
        status: noAddress ? "suppressed" : "queued",
        statusReason: noAddress ? `No ${s.channel === "sms" ? "phone number" : "email address"} on file` : "Queued; dispatch policy is checked immediately before sending",
        idempotencyKey,
        workflowRunId: ctx.run.id,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoNothing()
      .returning({ id: message.id });
    if (!m) throw new StepError("Message idempotency conflict", true);
    await ctx.tx.insert(messageEvent).values({ tenantId: ctx.run.tenantId, messageId: m.id, status: noAddress ? "suppressed" : "queued", detail: {}, occurredAt: ctx.now });
    await audit(ctx.tx, {
      tenantId: ctx.run.tenantId,
      actor: ctx.actor,
      action: noAddress ? "message.suppressed" : "message.queued",
      entityType: "message",
      entityId: m.id,
      contactId: ctx.run.contactId,
      correlationId: ctx.run.correlationId,
      summary: noAddress ? `Acknowledgment ${s.channel.toUpperCase()} not queued: no address on file` : `Acknowledgment ${s.channel.toUpperCase()} queued`,
      data: { runId: ctx.run.id, stepId: s.id },
      at: ctx.now,
    });
    if (noAddress) {
      const out = { messageId: m.id, outcome: "suppressed", reason: "no_address" };
      await completeEffect(ctx, out);
      return advance(ctx, out);
    }
    await ctx.tx.insert(outboxEvent).values({
      tenantId: ctx.run.tenantId,
      kind: "message.dispatch",
      aggregateId: m.id,
      idempotencyKey,
      payload: { runId: ctx.run.id, workflowId: ctx.run.workflowId },
      nextAttemptAt: ctx.now,
      createdAt: ctx.now,
    });
    await ctx.tx.insert(stepEffect).values({ tenantId: ctx.run.tenantId, runId: ctx.run.id, stepId: s.id, state: "pending", result: { messageId: m.id }, updatedAt: ctx.now });
    return { kind: "wait", wakeAt: null, reason: "awaiting_dispatch", output: { messageId: m.id } };
  },

  async finish(ctx) {
    await completeEffect(ctx, {});
    return { kind: "advance", next: null, output: {} };
  },
};

/** Human-readable instant in the business timezone for audit summaries (data keeps ISO UTC). */
function fmtLocal(ctx: StepCtx, d: Date) {
  const tz = String(ctx.run.context.businessTimezone ?? "America/New_York");
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(d);
}

function formatSeconds(s: number) {
  if (s % 86400 === 0) return `${s / 86400} day(s)`;
  if (s % 3600 === 0) return `${s / 3600} hour(s)`;
  if (s % 60 === 0) return `${s / 60} minute(s)`;
  return `${s} second(s)`;
}

// ----------------------------------------------------------------------------------------------
// Outbox dispatcher
// ----------------------------------------------------------------------------------------------
const MESSAGE_TERMINAL = new Set(["provider_accepted", "delivered", "failed", "suppressed", "unknown"]);
const DEFER_MS = 30_000;

async function wakeRun(tx: Tx, runId: string | undefined, now: Date) {
  if (!runId) return;
  await tx
    .update(workflowRun)
    .set({ wakeAt: now, updatedAt: now })
    .where(and(eq(workflowRun.id, runId), eq(workflowRun.status, "waiting"), eq(workflowRun.waitReason, "awaiting_dispatch")));
}

export async function processOutboxEvent(deps: EngineDeps, eventId: string, tenantId: string): Promise<void> {
  const now = deps.now();
  type Prepared = { send: true; to: string; channel: "sms" | "email"; body: string; idempotencyKey: string; messageId: string; runId?: string; attempts: number; maxAttempts: number; contactId: string };
  const prepared = await withTenant(tenantId, null, async (tx): Promise<Prepared | null> => {
    const [ev] = await tx.select().from(outboxEvent).where(eq(outboxEvent.id, eventId)).for("update");
    if (!ev || ev.status !== "pending" || ev.leaseOwner !== deps.workerId) return null;
    const runId = ev.payload.runId as string | undefined;
    const finish = (status: string, error?: string) =>
      tx.update(outboxEvent).set({ status, processedAt: now, leaseOwner: null, leaseExpiresAt: null, lastError: error ?? null }).where(eq(outboxEvent.id, ev.id));
    const [m] = await tx.select().from(message).where(eq(message.id, ev.aggregateId));
    if (!m) {
      await finish("dead", "message missing");
      return null;
    }
    if (MESSAGE_TERMINAL.has(m.status)) {
      await finish("done");
      await wakeRun(tx, runId, now);
      return null;
    }
    const setMsg = async (status: string, reason: string, detail: Record<string, unknown> = {}) => {
      await tx.update(message).set({ status, statusReason: reason, updatedAt: now }).where(eq(message.id, m.id));
      await tx.insert(messageEvent).values({ tenantId, messageId: m.id, status, detail: { reason, ...detail }, occurredAt: now });
    };
    const auditMsg = (action: string, summary: string, data: Record<string, unknown> = {}) =>
      audit(tx, { tenantId, actor: { type: "system", id: "dispatcher" }, action, entityType: "message", entityId: m.id, contactId: m.contactId, summary, data, at: now });

    // Dispatch policy, checked immediately before sending (not only when the workflow queued it).
    const [t] = await tx.select({ paused: tenant.sendingPaused, reason: tenant.sendingPausedReason }).from(tenant).where(eq(tenant.id, tenantId));
    const [wf] = ev.payload.workflowId ? await tx.select({ paused: workflow.paused }).from(workflow).where(eq(workflow.id, String(ev.payload.workflowId))) : [];
    const deferReason = t?.paused ? `Deferred: outbound sending is paused for this business${t.reason ? ` (${t.reason})` : ""}` : wf?.paused ? "Deferred: automation is paused" : null;
    if (deferReason) {
      if (m.statusReason !== deferReason) {
        await tx.update(message).set({ statusReason: deferReason, updatedAt: now }).where(eq(message.id, m.id));
        await auditMsg("message.dispatch_deferred", deferReason);
      }
      await tx.update(outboxEvent).set({ nextAttemptAt: new Date(now.getTime() + DEFER_MS), leaseOwner: null, leaseExpiresAt: null }).where(eq(outboxEvent.id, ev.id));
      return null;
    }
    const channel = m.channel as "sms" | "email";
    const purpose = (m.purpose ?? "transactional") as "transactional" | "marketing";
    const [latest] = await tx
      .select({ action: consentEvent.action })
      .from(consentEvent)
      .where(and(eq(consentEvent.contactId, m.contactId), eq(consentEvent.channel, channel), eq(consentEvent.purpose, purpose)))
      .orderBy(desc(consentEvent.occurredAt))
      .limit(1);
    const [sup] = m.toAddress ? await tx.select({ reason: suppression.reason }).from(suppression).where(and(eq(suppression.channel, channel), eq(suppression.address, m.toAddress))) : [];
    const block = sup
      ? `Suppressed: address is on the suppression list (${sup.reason})`
      : latest?.action !== "granted"
        ? `Suppressed: no ${purpose} ${channel.toUpperCase()} consent on record${latest ? " (revoked)" : ""}`
        : null;
    if (block) {
      await setMsg("suppressed", block);
      await finish("done");
      await auditMsg("message.suppressed", block);
      await wakeRun(tx, runId, now);
      return null;
    }
    if (m.status === "dispatching") {
      // A previous dispatch was interrupted after the provider may have accepted the message.
      if (!deps.provider.supportsIdempotentRetry) {
        await setMsg("unknown", "Dispatch interrupted and provider cannot deduplicate; outcome unknown");
        await finish("needs_review");
        await auditMsg("message.outcome_unknown", "Dispatch was interrupted; outcome unknown. Routed to review instead of resending.");
        await wakeRun(tx, runId, now);
        return null;
      }
      await auditMsg("message.dispatch_resumed", "Resuming an interrupted dispatch with the same idempotency key (provider deduplicates)");
    }
    await tx.update(message).set({ status: "dispatching", statusReason: "Dispatching", updatedAt: now }).where(eq(message.id, m.id));
    await tx.update(outboxEvent).set({ attempts: ev.attempts + 1 }).where(eq(outboxEvent.id, ev.id));
    return {
      send: true,
      to: m.toAddress!,
      channel,
      body: m.body,
      idempotencyKey: ev.idempotencyKey,
      messageId: m.id,
      runId,
      attempts: ev.attempts + 1,
      maxAttempts: ev.maxAttempts,
      contactId: m.contactId,
    };
  });
  if (!prepared) return;

  const result = await deps.provider.send({ tenantId, idempotencyKey: prepared.idempotencyKey, channel: prepared.channel, to: prepared.to, body: prepared.body });
  maybeCrash("after_provider_send");

  await withTenant(tenantId, null, async (tx) => {
    const [ev] = await tx.select().from(outboxEvent).where(eq(outboxEvent.id, eventId)).for("update");
    if (!ev || ev.leaseOwner !== deps.workerId) return; // lease lost; the next holder resumes idempotently
    const done = { leaseOwner: null, leaseExpiresAt: null, processedAt: now };
    const auditBase = { tenantId, entityType: "message", entityId: prepared.messageId, contactId: prepared.contactId, at: now } as const;
    if (result.ok) {
      const simNote = deps.provider.simulated ? " by LOCAL SIMULATOR — no real message was sent" : "";
      await tx
        .update(message)
        .set({
          status: "provider_accepted",
          statusReason: deps.provider.simulated ? "Accepted by local simulator (not a real delivery)" : "Accepted by provider; delivery not yet confirmed",
          provider: deps.provider.name,
          providerMessageId: result.providerMessageId,
          simulated: deps.provider.simulated,
          updatedAt: now,
        })
        .where(eq(message.id, prepared.messageId));
      await tx.insert(messageEvent).values({ tenantId, messageId: prepared.messageId, status: "provider_accepted", detail: { providerMessageId: result.providerMessageId, simulated: deps.provider.simulated, replayed: result.replayed, attempt: prepared.attempts }, occurredAt: now });
      await tx.update(outboxEvent).set({ status: "done", ...done }).where(eq(outboxEvent.id, eventId));
      await audit(tx, { ...auditBase, actor: { type: "local_provider", id: deps.provider.name }, action: "message.provider_accepted", summary: `Acknowledgment ${prepared.channel.toUpperCase()} accepted${simNote}`, data: { providerMessageId: result.providerMessageId, attempt: prepared.attempts, replayed: result.replayed } });
      await wakeRun(tx, prepared.runId, now);
      return;
    }
    if (result.retryable && prepared.attempts < prepared.maxAttempts) {
      const retryAt = new Date(now.getTime() + backoffMs(prepared.attempts));
      await tx.update(message).set({ status: "queued", statusReason: `Retry ${prepared.attempts + 1}/${prepared.maxAttempts} scheduled: ${result.error}`, updatedAt: now }).where(eq(message.id, prepared.messageId));
      await tx.insert(messageEvent).values({ tenantId, messageId: prepared.messageId, status: "attempt_failed_retryable", detail: { error: result.error, attempt: prepared.attempts, retryAt: retryAt.toISOString() }, occurredAt: now });
      await tx.update(outboxEvent).set({ status: "pending", nextAttemptAt: retryAt, lastError: result.error, leaseOwner: null, leaseExpiresAt: null }).where(eq(outboxEvent.id, eventId));
      await audit(tx, { ...auditBase, actor: { type: "system", id: "dispatcher" }, action: "message.retry_scheduled", summary: `Send attempt ${prepared.attempts} failed (${result.error}); retry scheduled`, data: { attempt: prepared.attempts, retryAt: retryAt.toISOString() } });
      return;
    }
    await tx.update(message).set({ status: "failed", statusReason: result.error, updatedAt: now }).where(eq(message.id, prepared.messageId));
    await tx.insert(messageEvent).values({ tenantId, messageId: prepared.messageId, status: "failed", detail: { error: result.error, attempt: prepared.attempts, retryable: result.retryable }, occurredAt: now });
    await tx.update(outboxEvent).set({ status: "dead", lastError: result.error, ...done }).where(eq(outboxEvent.id, eventId));
    await audit(tx, { ...auditBase, actor: { type: "system", id: "dispatcher" }, action: "message.failed", summary: `Acknowledgment failed after ${prepared.attempts} attempt(s): ${result.error}`, data: { attempt: prepared.attempts } });
    await wakeRun(tx, prepared.runId, now);
  });
}
