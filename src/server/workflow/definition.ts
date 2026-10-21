import { z } from "zod";

/**
 * Workflow definition, schema version 1 (shared by server and the browser editor; no Node APIs). Steps form a directed acyclic graph: each step continues
 * to `next` (or the following step in the list), branches choose onTrue/onFalse, finish ends.
 * Cycles and unbounded loops are rejected at publication.
 */
export const SCHEMA_VERSION = 1;

const stepId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "Step ids use lowercase letters, digits and underscores (max 40)");
const template = (max: number) => z.string().trim().min(1, "Required").max(max);
const base = { id: stepId, name: z.string().trim().max(80).optional(), next: stepId.nullable().optional() };

export const createOpportunityStep = z.object({
  ...base,
  type: z.literal("create_opportunity"),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid(),
  title: template(140),
  valueCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

export const createTaskStep = z.object({
  ...base,
  type: z.literal("create_task"),
  title: template(140),
  description: z.string().trim().max(1000).optional(),
  assigneeUserId: z.string().min(1, "Choose an assignee"),
  dueInMinutes: z.number().int().min(0).max(60 * 24 * 60),
});

export const waitStep = z.object({
  ...base,
  type: z.literal("wait"),
  seconds: z.number().int().min(1).max(60 * 60 * 24 * 30),
});

export const branchCondition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task_completed"), taskStepId: stepId }),
  z.object({ kind: z.literal("contact_has_phone") }),
  z.object({ kind: z.literal("contact_has_email") }),
]);

export const branchStep = z.object({
  ...base,
  type: z.literal("branch"),
  condition: branchCondition,
  onTrue: stepId,
  onFalse: stepId,
});

export const sendMessageStep = z.object({
  ...base,
  type: z.literal("send_message"),
  channel: z.enum(["sms", "email"]),
  /** Milestone 1 supports transactional acknowledgments only. Marketing requires M2 controls. */
  purpose: z.literal("transactional"),
  subject: z.string().trim().max(140).optional(),
  body: template(640),
});

export const finishStep = z.object({ ...base, type: z.literal("finish") });

export const step = z.discriminatedUnion("type", [
  createOpportunityStep,
  createTaskStep,
  waitStep,
  branchStep,
  sendMessageStep,
  finishStep,
]);
export type Step = z.infer<typeof step>;
export type StepType = Step["type"];

export const definitionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  trigger: z.object({ type: z.literal("form.submitted"), formId: z.string().uuid().nullable() }),
  steps: z.array(step).min(1, "Add at least one step").max(25, "Milestone 1 allows up to 25 steps"),
});
export type WorkflowDefinition = z.infer<typeof definitionSchema>;

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  create_opportunity: "Create opportunity",
  create_task: "Create staff task",
  wait: "Wait",
  branch: "Branch (if / else)",
  send_message: "Send acknowledgment",
  finish: "Finish",
};

export interface Issue {
  path: string;
  message: string;
}

export function parseDefinition(raw: unknown): { ok: true; def: WorkflowDefinition } | { ok: false; issues: Issue[] } {
  const r = definitionSchema.safeParse(raw);
  if (!r.success) {
    return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  return { ok: true, def: r.data };
}

export const TEMPLATE_VARIABLES = [
  "contact.firstName",
  "contact.lastName",
  "contact.displayName",
  "business.name",
  "submission.message",
] as const;
const TEMPLATE_RE = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

export function templateIssues(text: string): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(TEMPLATE_RE)) {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(m[1]!)) bad.push(m[1]!);
  }
  return bad;
}

export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(TEMPLATE_RE, (_, k: string) => vars[k] ?? "");
}

/** Resolves the step that follows `s` when it does not branch. */
export function nextStepId(def: WorkflowDefinition, s: Step): string | null {
  if (s.type === "finish") return null;
  if (s.next !== undefined) return s.next;
  const i = def.steps.findIndex((x) => x.id === s.id);
  return def.steps[i + 1]?.id ?? null;
}

export function successors(def: WorkflowDefinition, s: Step): string[] {
  if (s.type === "branch") return [s.onTrue, s.onFalse];
  const n = nextStepId(def, s);
  return n ? [n] : [];
}

/**
 * Structural validation beyond the schema: unique ids, references, unknown template variables,
 * cycles, unreachable steps, and branch conditions that refer to a task created earlier.
 * Tenant-dependent references (pipelines, stages, assignees) are checked by the workflow service.
 */
export function validateStructure(def: WorkflowDefinition): Issue[] {
  const issues: Issue[] = [];
  const ids = new Map<string, Step>();
  def.steps.forEach((s, i) => {
    if (ids.has(s.id)) issues.push({ path: `steps.${i}.id`, message: `Duplicate step id "${s.id}"` });
    ids.set(s.id, s);
  });
  def.steps.forEach((s, i) => {
    for (const ref of successors(def, s)) {
      if (!ids.has(ref)) issues.push({ path: `steps.${i}`, message: `Step "${s.id}" points to missing step "${ref}"` });
    }
    const texts: [string, string | undefined][] =
      s.type === "send_message"
        ? [["body", s.body], ["subject", s.subject]]
        : s.type === "create_task"
          ? [["title", s.title], ["description", s.description]]
          : s.type === "create_opportunity"
            ? [["title", s.title]]
            : [];
    for (const [field, t] of texts) {
      for (const v of templateIssues(t ?? "")) {
        issues.push({ path: `steps.${i}.${field}`, message: `Unknown template variable {{${v}}}` });
      }
    }
  });
  if (issues.length) return issues;

  // Cycle detection (DFS with colors) from the entry step; also collects reachability.
  const color = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const visit = (id: string, path: string[]): void => {
    const c = color.get(id) ?? 0;
    if (c === 1) {
      issues.push({ path: "steps", message: `Cycle detected: ${[...path, id].join(" → ")}` });
      return;
    }
    if (c === 2) return;
    color.set(id, 1);
    for (const n of successors(def, ids.get(id)!)) visit(n, [...path, id]);
    color.set(id, 2);
    order.push(id);
  };
  visit(def.steps[0]!.id, []);
  def.steps.forEach((s, i) => {
    if (!color.has(s.id)) issues.push({ path: `steps.${i}`, message: `Step "${s.id}" is unreachable` });
  });

  if (issues.length) return issues;

  // A task_completed condition must reference a create_task step that always runs before it.
  const before = predecessorsOnAllPaths(def, ids);
  def.steps.forEach((s, i) => {
    if (s.type === "branch" && s.condition.kind === "task_completed") {
      const ref = ids.get(s.condition.taskStepId);
      if (!ref || ref.type !== "create_task") {
        issues.push({ path: `steps.${i}.condition`, message: `"${s.condition.taskStepId}" is not a create-task step` });
      } else if (!before.get(s.id)?.has(ref.id)) {
        issues.push({ path: `steps.${i}.condition`, message: `Task step "${ref.id}" does not always run before "${s.id}"` });
      }
    }
  });
  return issues;
}

function predecessorsOnAllPaths(def: WorkflowDefinition, ids: Map<string, Step>): Map<string, Set<string>> {
  // Dominator-style: steps guaranteed to have executed before each step (graph is a DAG here).
  const preds = new Map<string, string[]>();
  for (const s of def.steps) for (const n of successors(def, s)) preds.set(n, [...(preds.get(n) ?? []), s.id]);
  const memo = new Map<string, Set<string>>();
  const dom = (id: string): Set<string> => {
    if (memo.has(id)) return memo.get(id)!;
    const ps = preds.get(id) ?? [];
    let acc: Set<string> | undefined;
    for (const p of ps) {
      const d = new Set(dom(p));
      d.add(p);
      const prev: Set<string> | undefined = acc;
      acc = prev === undefined ? d : new Set([...prev].filter((x) => d.has(x)));
    }
    const res = acc ?? new Set<string>();
    memo.set(id, res);
    return res;
  };
  for (const id of ids.keys()) dom(id);
  return memo;
}
