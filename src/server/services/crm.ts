import { and, asc, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant, withUser } from "@/db/client";
import {
  auditEvent,
  authUser,
  consentEvent,
  contact,
  conversation,
  duplicateSuggestion,
  formSubmission,
  membership,
  message,
  opportunity,
  pipeline,
  stage,
  task,
  tenant,
  workflow,
  workflowRun,
} from "@/db/schema";
import { audit, userActor } from "../audit";
import { authorize, can, maskEmail, maskPhone, type Actor, type Role } from "../authz";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { displayName, normalizeEmail, normalizeName, normalizePhone } from "../normalize";
import { isUuid } from "../util";

const PAGE_SIZE = 25;

function requireUuid(id: string) {
  if (!isUuid(id)) throw new NotFoundError();
}

// ---------------------------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------------------------
export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  role: Role;
}

/** Memberships for a signed-in user. Tenant scope is always derived from this list. */
export async function listMemberships(userId: string): Promise<MembershipSummary[]> {
  return withUser(userId, (tx) =>
    tx
      .select({ tenantId: membership.tenantId, tenantName: tenant.name, role: membership.role })
      .from(membership)
      .innerJoin(tenant, eq(tenant.id, membership.tenantId))
      .where(eq(membership.userId, userId))
      .orderBy(asc(tenant.name)),
  );
}

export async function resolveActor(user: { id: string; name: string; email: string }, requestedTenantId: string | null): Promise<Actor | null> {
  const ms = await listMemberships(user.id);
  const m = ms.find((x) => x.tenantId === requestedTenantId) ?? ms[0];
  if (!m) return null;
  return { userId: user.id, tenantId: m.tenantId, role: m.role, name: user.name, email: user.email };
}

export async function getTenantSummary(actor: Actor) {
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [t] = await tx.select().from(tenant).where(eq(tenant.id, actor.tenantId));
    return t!;
  });
}

export async function listMembers(actor: Actor) {
  return withTenant(actor.tenantId, actor.userId, (tx) =>
    tx
      .select({ userId: membership.userId, role: membership.role, name: authUser.name, email: authUser.email, mfa: authUser.twoFactorEnabled })
      .from(membership)
      .innerJoin(authUser, eq(authUser.id, membership.userId))
      .where(eq(membership.tenantId, actor.tenantId))
      .orderBy(asc(authUser.name)),
  );
}

// ---------------------------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------------------------
export function presentContact(actor: Actor, c: typeof contact.$inferSelect) {
  const sensitive = can(actor, "contacts.read_sensitive");
  return {
    id: c.id,
    displayName: c.displayName,
    firstName: c.firstName,
    lastName: c.lastName,
    email: sensitive ? c.email : maskEmail(c.email),
    phone: sensitive ? c.phone : maskPhone(c.phone),
    masked: !sensitive,
    ownerUserId: c.ownerUserId,
    source: c.source,
    tags: c.tags,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
export type ContactView = ReturnType<typeof presentContact>;

export async function listContacts(actor: Actor, opts: { q?: string; page?: number } = {}) {
  authorize(actor, "contacts.read");
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const q = (opts.q ?? "").trim().slice(0, 100);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const filters = [eq(contact.tenantId, actor.tenantId)];
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const digits = q.replace(/\D/g, "");
      const ors = [ilike(contact.displayName, like), ilike(contact.emailNormalized, like)];
      if (digits.length >= 4) ors.push(ilike(contact.phoneE164, `%${digits}%`));
      filters.push(or(...ors)!);
    }
    const where = and(...filters);
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(contact).where(where);
    const rows = await tx
      .select()
      .from(contact)
      .where(where)
      .orderBy(desc(contact.createdAt), asc(contact.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    return { rows: rows.map((r) => presentContact(actor, r)), total, page, pageSize: PAGE_SIZE };
  });
}

export async function getContact(actor: Actor, contactId: string) {
  authorize(actor, "contacts.read");
  requireUuid(contactId);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [c] = await tx.select().from(contact).where(eq(contact.id, contactId));
    if (!c) throw new NotFoundError("Contact not found");
    const opps = await tx
      .select({ id: opportunity.id, name: opportunity.name, stageName: stage.name, stageKind: stage.kind, valueCents: opportunity.valueCents, currency: opportunity.currency, createdAt: opportunity.createdAt })
      .from(opportunity)
      .innerJoin(stage, eq(stage.id, opportunity.stageId))
      .where(eq(opportunity.contactId, contactId))
      .orderBy(desc(opportunity.createdAt));
    const tasks = await tx
      .select({ id: task.id, title: task.title, status: task.status, dueAt: task.dueAt, assigneeUserId: task.assigneeUserId, assigneeName: authUser.name, completedAt: task.completedAt })
      .from(task)
      .leftJoin(authUser, eq(authUser.id, task.assigneeUserId))
      .where(eq(task.contactId, contactId))
      .orderBy(asc(task.status), asc(task.dueAt));
    const consents = await tx.select().from(consentEvent).where(eq(consentEvent.contactId, contactId)).orderBy(desc(consentEvent.occurredAt));
    const dups = await tx
      .select({ id: duplicateSuggestion.id, candidateId: duplicateSuggestion.candidateContactId, reason: duplicateSuggestion.reason, candidateName: contact.displayName })
      .from(duplicateSuggestion)
      .innerJoin(contact, eq(contact.id, duplicateSuggestion.candidateContactId))
      .where(and(eq(duplicateSuggestion.contactId, contactId), eq(duplicateSuggestion.status, "open")));
    const [conv] = await tx.select().from(conversation).where(eq(conversation.contactId, contactId));
    const submissions = await tx.select({ id: formSubmission.id, attribution: formSubmission.attribution, submittedAt: formSubmission.submittedAt }).from(formSubmission).where(eq(formSubmission.contactId, contactId)).orderBy(desc(formSubmission.submittedAt));
    // Current consent state = latest event per (channel, purpose).
    const current = new Map<string, (typeof consents)[number]>();
    for (const e of consents) if (!current.has(`${e.channel}:${e.purpose}`)) current.set(`${e.channel}:${e.purpose}`, e);
    return {
      contact: presentContact(actor, c),
      opportunities: opps,
      tasks,
      consent: [...current.values()].map((e) => ({ channel: e.channel, purpose: e.purpose, action: e.action, source: e.source, occurredAt: e.occurredAt })),
      duplicates: dups,
      conversation: conv ?? null,
      submissions,
    };
  });
}

export interface TimelineEntry {
  id: string;
  at: Date;
  action: string;
  summary: string;
  actorType: string;
  actorLabel: string;
  entityType: string;
  entityId: string;
  message?: { body: string; direction: string; channel: string; status: string; simulated: boolean; statusReason: string | null };
}

export async function getTimeline(actor: Actor, contactId: string): Promise<TimelineEntry[]> {
  authorize(actor, "contacts.read");
  requireUuid(contactId);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [c] = await tx.select({ id: contact.id }).from(contact).where(eq(contact.id, contactId));
    if (!c) throw new NotFoundError("Contact not found");
    const events = await tx.select().from(auditEvent).where(eq(auditEvent.contactId, contactId)).orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id)).limit(300);
    const msgs = await tx.select().from(message).where(eq(message.contactId, contactId));
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const users = await tx.select({ id: authUser.id, name: authUser.name }).from(membership).innerJoin(authUser, eq(authUser.id, membership.userId)).where(eq(membership.tenantId, actor.tenantId));
    const userNames = new Map(users.map((u) => [u.id, u.name]));
    const sensitive = can(actor, "contacts.read_sensitive");
    const entries: TimelineEntry[] = events.map((e) => ({
      id: e.id,
      at: e.occurredAt,
      action: e.action,
      summary: e.summary,
      actorType: e.actorType,
      actorLabel: actorLabel(e.actorType, (e.data as { actorName?: string }).actorName ?? (e.actorId ? userNames.get(e.actorId) : undefined)),
      entityType: e.entityType,
      entityId: e.entityId,
    }));
    // Attach message content to the first event about each message; also surface messages that
    // have no audit event (inbound form inquiry, notes created before auditing).
    const seen = new Set<string>();
    for (const en of entries) {
      if (en.entityType === "message" && !seen.has(en.entityId)) {
        const m = byId.get(en.entityId);
        if (m) {
          seen.add(m.id);
          en.message = { body: sensitive || m.direction === "note" ? m.body : "[message content hidden for your role]", direction: m.direction, channel: m.channel, status: m.status, simulated: m.simulated, statusReason: m.statusReason };
        }
      }
    }
    for (const m of msgs) {
      if (seen.has(m.id) || m.direction !== "inbound") continue;
      entries.push({
        id: `msg-${m.id}`,
        at: m.createdAt,
        action: "message.inbound",
        summary: m.channel === "form" ? "Inquiry message from web form" : "Inbound message",
        actorType: "contact",
        actorLabel: "Contact",
        entityType: "message",
        entityId: m.id,
        message: { body: sensitive ? m.body : "[message content hidden for your role]", direction: m.direction, channel: m.channel, status: m.status, simulated: m.simulated, statusReason: m.statusReason },
      });
    }
    return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  });
}

function actorLabel(type: string, name?: string) {
  switch (type) {
    case "user":
      return name ?? "Team member";
    case "workflow":
      return `Automation${name ? `: ${name}` : ""}`;
    case "public_form":
      return "Web form";
    case "local_provider":
      return "Local simulator";
    case "system":
      return "System";
    default:
      return type;
  }
}

const contactInput = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(100),
    lastName: z.string().trim().max(100).default(""),
    email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]).default(""),
    phone: z.string().trim().max(40).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.phone && !normalizePhone(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid phone number" });
  });

export async function createContact(actor: Actor, input: unknown) {
  authorize(actor, "contacts.write");
  const r = contactInput.safeParse(input);
  if (!r.success) throw new ValidationError("Please correct the highlighted fields", r.error.flatten().fieldErrors);
  const v = r.data;
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [c] = await tx
      .insert(contact)
      .values({
        tenantId: actor.tenantId,
        firstName: v.firstName,
        lastName: v.lastName,
        displayName: displayName(v.firstName, v.lastName),
        nameNormalized: normalizeName(v.firstName, v.lastName),
        email: v.email || null,
        emailNormalized: normalizeEmail(v.email),
        phone: v.phone || null,
        phoneE164: normalizePhone(v.phone),
        ownerUserId: actor.userId,
        source: "manual",
      })
      .returning();
    await audit(tx, { tenantId: actor.tenantId, actor: userActor(actor), action: "contact.created", entityType: "contact", entityId: c!.id, contactId: c!.id, summary: "Contact created manually" });
    return presentContact(actor, c!);
  });
}

// ---------------------------------------------------------------------------------------------
// Pipelines and opportunities
// ---------------------------------------------------------------------------------------------
export async function getPipelineBoard(actor: Actor) {
  authorize(actor, "contacts.read");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [p] = await tx.select().from(pipeline).where(eq(pipeline.tenantId, actor.tenantId)).orderBy(desc(pipeline.isDefault), asc(pipeline.createdAt)).limit(1);
    if (!p) return null;
    const stages = await tx.select().from(stage).where(eq(stage.pipelineId, p.id)).orderBy(asc(stage.position));
    const opps = await tx
      .select({ id: opportunity.id, name: opportunity.name, stageId: opportunity.stageId, valueCents: opportunity.valueCents, currency: opportunity.currency, contactId: contact.id, contactName: contact.displayName, updatedAt: opportunity.updatedAt })
      .from(opportunity)
      .innerJoin(contact, eq(contact.id, opportunity.contactId))
      .where(eq(opportunity.pipelineId, p.id))
      .orderBy(desc(opportunity.updatedAt))
      .limit(500);
    return { pipeline: p, stages, opportunities: opps };
  });
}

export async function listPipelinesWithStages(actor: Actor) {
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const ps = await tx.select().from(pipeline).where(eq(pipeline.tenantId, actor.tenantId));
    const ss = await tx.select().from(stage).where(eq(stage.tenantId, actor.tenantId)).orderBy(asc(stage.position));
    return ps.map((p) => ({ ...p, stages: ss.filter((s) => s.pipelineId === p.id) }));
  });
}

export async function moveOpportunity(actor: Actor, opportunityId: string, stageId: string) {
  authorize(actor, "opportunities.write");
  requireUuid(opportunityId);
  requireUuid(stageId);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [o] = await tx.select().from(opportunity).where(eq(opportunity.id, opportunityId)).for("update");
    if (!o) throw new NotFoundError("Opportunity not found");
    const [from] = await tx.select().from(stage).where(eq(stage.id, o.stageId));
    const [to] = await tx.select().from(stage).where(and(eq(stage.id, stageId), eq(stage.pipelineId, o.pipelineId)));
    if (!to) throw new ValidationError("That stage is not part of this opportunity's pipeline");
    if (to.id === o.stageId) return { changed: false };
    await tx.update(opportunity).set({ stageId: to.id, updatedAt: new Date() }).where(eq(opportunity.id, o.id));
    // Stage changes are recorded as auditable domain events (workflow triggers on them: Milestone 2).
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: "opportunity.stage_changed",
      entityType: "opportunity",
      entityId: o.id,
      contactId: o.contactId,
      summary: `Opportunity "${o.name}" moved from "${from?.name}" to "${to.name}"`,
      data: { fromStageId: o.stageId, toStageId: to.id },
    });
    return { changed: true };
  });
}

// ---------------------------------------------------------------------------------------------
// Tasks and the Today queue
// ---------------------------------------------------------------------------------------------
export async function completeTask(actor: Actor, taskId: string) {
  requireUuid(taskId);
  if (!can(actor, "tasks.complete_own")) throw new ForbiddenError("Your role cannot complete tasks");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [t] = await tx.select().from(task).where(eq(task.id, taskId)).for("update");
    if (!t) throw new NotFoundError("Task not found");
    if (!can(actor, "tasks.complete_any") && t.assigneeUserId !== actor.userId) {
      throw new ForbiddenError("You can only complete tasks assigned to you");
    }
    if (t.status !== "open") return { changed: false, status: t.status };
    const now = new Date();
    await tx.update(task).set({ status: "completed", completedAt: now, completedByUserId: actor.userId }).where(eq(task.id, t.id));
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: "task.completed",
      entityType: "task",
      entityId: t.id,
      contactId: t.contactId,
      summary: `Task "${t.title}" completed${t.dueAt && t.dueAt < now ? " (after due time)" : ""}`,
      data: { dueAt: t.dueAt?.toISOString() ?? null },
    });
    return { changed: true, status: "completed" as const };
  });
}

export interface TodayRow {
  kind: "overdue_task" | "due_task" | "unanswered" | "failed_automation";
  id: string;
  title: string;
  reason: string;
  ownerName: string | null;
  recordLabel: string;
  recordHref: string;
  action: { type: "complete_task"; taskId: string; allowed: boolean } | { type: "link"; href: string; label: string };
  at: Date | null;
}

export async function getToday(actor: Actor, now = new Date()) {
  authorize(actor, "contacts.read");
  const mineOnly = actor.role === "staff" || actor.role === "restricted_staff";
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const taskWhere = [eq(task.status, "open")];
    if (mineOnly) taskWhere.push(or(eq(task.assigneeUserId, actor.userId), isNull(task.assigneeUserId))!);
    const tasks = await tx
      .select({ id: task.id, title: task.title, dueAt: task.dueAt, assigneeUserId: task.assigneeUserId, assigneeName: authUser.name, contactId: task.contactId, contactName: contact.displayName })
      .from(task)
      .leftJoin(authUser, eq(authUser.id, task.assigneeUserId))
      .leftJoin(contact, eq(contact.id, task.contactId))
      .where(and(...taskWhere))
      .orderBy(asc(task.dueAt))
      .limit(100);
    const unanswered = await tx
      .select({ id: conversation.id, contactId: contact.id, contactName: contact.displayName, lastInboundAt: conversation.lastInboundAt, assigneeName: authUser.name })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .leftJoin(authUser, eq(authUser.id, conversation.assigneeUserId))
      .where(eq(conversation.unanswered, true))
      .orderBy(asc(conversation.lastInboundAt))
      .limit(50);
    const failed = can(actor, "workflows.read")
      ? await tx
          .select({ id: workflowRun.id, status: workflowRun.status, error: workflowRun.error, updatedAt: workflowRun.updatedAt, workflowName: workflow.name, contactId: workflowRun.contactId, contactName: contact.displayName })
          .from(workflowRun)
          .innerJoin(workflow, eq(workflow.id, workflowRun.workflowId))
          .leftJoin(contact, eq(contact.id, workflowRun.contactId))
          .where(inArray(workflowRun.status, ["failed", "needs_review"]))
          .orderBy(desc(workflowRun.updatedAt))
          .limit(50)
      : [];

    const rows: TodayRow[] = [];
    const canComplete = (assignee: string | null) => can(actor, "tasks.complete_any") || (can(actor, "tasks.complete_own") && assignee === actor.userId);
    for (const t of tasks) {
      const overdue = t.dueAt !== null && t.dueAt < now;
      rows.push({
        kind: overdue ? "overdue_task" : "due_task",
        id: t.id,
        title: t.title,
        reason: t.dueAt ? (overdue ? `Overdue by ${humanizeMs(now.getTime() - t.dueAt.getTime())}` : `Due in ${humanizeMs(t.dueAt.getTime() - now.getTime())}`) : "No due time",
        ownerName: t.assigneeName ?? null,
        recordLabel: t.contactName ?? "No contact",
        recordHref: t.contactId ? `/contacts/${t.contactId}` : "/today",
        action: { type: "complete_task", taskId: t.id, allowed: canComplete(t.assigneeUserId) },
        at: t.dueAt,
      });
    }
    for (const u of unanswered) {
      rows.push({
        kind: "unanswered",
        id: u.id,
        title: `Inquiry from ${u.contactName} has no logged reply`,
        reason: u.lastInboundAt ? `Waiting ${humanizeMs(now.getTime() - u.lastInboundAt.getTime())}` : "Waiting",
        ownerName: u.assigneeName ?? null,
        recordLabel: u.contactName,
        recordHref: `/contacts/${u.contactId}`,
        action: { type: "link", href: `/inbox?c=${u.id}`, label: "Open conversation" },
        at: u.lastInboundAt,
      });
    }
    for (const f of failed) {
      rows.push({
        kind: "failed_automation",
        id: f.id,
        title: `Automation "${f.workflowName}" ${f.status === "failed" ? "failed" : "needs review"}`,
        reason: f.error ?? "See run details",
        ownerName: null,
        recordLabel: f.contactName ?? "—",
        recordHref: f.contactId ? `/contacts/${f.contactId}` : "/automations",
        action: { type: "link", href: `/automations/runs/${f.id}`, label: "Review run" },
        at: f.updatedAt,
      });
    }
    return {
      overdue: rows.filter((r) => r.kind === "overdue_task"),
      due: rows.filter((r) => r.kind === "due_task"),
      unanswered: rows.filter((r) => r.kind === "unanswered"),
      failed: rows.filter((r) => r.kind === "failed_automation"),
      scope: mineOnly ? ("mine" as const) : ("team" as const),
      generatedAt: now,
    };
  });
}

export function humanizeMs(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "less than a minute";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr`;
  return `${Math.round(h / 24)} days`;
}

// ---------------------------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------------------------
export async function listConversations(actor: Actor) {
  authorize(actor, "contacts.read");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const rows = await tx
      .select({ id: conversation.id, contactId: contact.id, contactName: contact.displayName, unanswered: conversation.unanswered, lastActivityAt: conversation.lastActivityAt, assigneeName: authUser.name })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .leftJoin(authUser, eq(authUser.id, conversation.assigneeUserId))
      .orderBy(desc(conversation.unanswered), desc(conversation.lastActivityAt))
      .limit(100);
    return rows;
  });
}

export async function getConversation(actor: Actor, conversationId: string) {
  authorize(actor, "contacts.read");
  requireUuid(conversationId);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [c] = await tx.select().from(conversation).where(eq(conversation.id, conversationId));
    if (!c) throw new NotFoundError("Conversation not found");
    const [ct] = await tx.select().from(contact).where(eq(contact.id, c.contactId));
    const msgs = await tx
      .select({ m: message, authorName: authUser.name })
      .from(message)
      .leftJoin(authUser, eq(authUser.id, message.authorUserId))
      .where(eq(message.conversationId, c.id))
      .orderBy(asc(message.createdAt));
    const sensitive = can(actor, "contacts.read_sensitive");
    return {
      conversation: c,
      contact: presentContact(actor, ct!),
      messages: msgs.map(({ m, authorName }) => ({ ...m, authorName, body: sensitive || m.direction === "note" ? m.body : "[message content hidden for your role]", toAddress: sensitive ? m.toAddress : null })),
    };
  });
}

const noteInput = z.object({ body: z.string().trim().min(1, "Write a note").max(2000), markAnswered: z.boolean().default(false) });

export async function addNote(actor: Actor, conversationId: string, input: unknown) {
  authorize(actor, "notes.write");
  requireUuid(conversationId);
  const r = noteInput.safeParse(input);
  if (!r.success) throw new ValidationError("Note is invalid", r.error.flatten().fieldErrors);
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const [c] = await tx.select().from(conversation).where(eq(conversation.id, conversationId)).for("update");
    if (!c) throw new NotFoundError("Conversation not found");
    const now = new Date();
    const [m] = await tx
      .insert(message)
      .values({ tenantId: actor.tenantId, conversationId: c.id, contactId: c.contactId, direction: "note", channel: "note", body: r.data.body, status: "recorded", authorUserId: actor.userId })
      .returning({ id: message.id });
    await tx.update(conversation).set({ lastActivityAt: now, ...(r.data.markAnswered ? { unanswered: false } : {}) }).where(eq(conversation.id, c.id));
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: "note.added",
      entityType: "message",
      entityId: m!.id,
      contactId: c.contactId,
      summary: r.data.markAnswered ? "Internal note added; inquiry marked as answered" : "Internal note added",
    });
    return { id: m!.id };
  });
}

// ---------------------------------------------------------------------------------------------
// Export (permission-aware CSV). Full tenant archive is Milestone 3.
// ---------------------------------------------------------------------------------------------
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export async function exportCsv(actor: Actor, kind: "contacts" | "opportunities") {
  authorize(actor, "export.data");
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    let csv: string;
    let rowCount: number;
    if (kind === "contacts") {
      const rows = await tx.select().from(contact).orderBy(asc(contact.createdAt), asc(contact.id));
      rowCount = rows.length;
      csv = toCsv(
        ["id", "first_name", "last_name", "email", "phone_e164", "source", "owner_user_id", "created_at", "updated_at"],
        rows.map((c) => [c.id, c.firstName, c.lastName, c.email, c.phoneE164, c.source, c.ownerUserId, c.createdAt, c.updatedAt]),
      );
    } else {
      const rows = await tx
        .select({ o: opportunity, stageName: stage.name, pipelineName: pipeline.name })
        .from(opportunity)
        .innerJoin(stage, eq(stage.id, opportunity.stageId))
        .innerJoin(pipeline, eq(pipeline.id, opportunity.pipelineId))
        .orderBy(asc(opportunity.createdAt), asc(opportunity.id));
      rowCount = rows.length;
      csv = toCsv(
        ["id", "contact_id", "name", "pipeline", "stage", "estimated_value_minor_units", "currency", "created_at", "updated_at"],
        rows.map(({ o, stageName, pipelineName }) => [o.id, o.contactId, o.name, pipelineName, stageName, o.valueCents, o.currency, o.createdAt, o.updatedAt]),
      );
    }
    await audit(tx, {
      tenantId: actor.tenantId,
      actor: userActor(actor),
      action: "export.generated",
      entityType: "export",
      entityId: kind,
      summary: `Exported ${rowCount} ${kind} as CSV`,
      data: { kind, rowCount },
    });
    return { csv, rowCount };
  });
}

// ---------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------
export async function listAudit(actor: Actor, opts: { page?: number } = {}) {
  authorize(actor, "audit.read");
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  return withTenant(actor.tenantId, actor.userId, async (tx) => {
    const rows = await tx
      .select()
      .from(auditEvent)
      .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
      .limit(50)
      .offset((page - 1) * 50);
    return { rows, page };
  });
}

