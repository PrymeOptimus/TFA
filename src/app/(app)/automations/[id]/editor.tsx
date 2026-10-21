"use client";
import { useMemo, useState, useTransition } from "react";
import { Button, Badge, inputClass } from "@/components/ui";
import {
  SCHEMA_VERSION,
  STEP_TYPE_LABELS,
  TEMPLATE_VARIABLES,
  parseDefinition,
  validateStructure,
  type Issue,
  type Step,
  type StepType,
} from "@/server/workflow/definition";
import { saveDraftAction } from "../../actions";

type Option = { id: string; label: string };
type PipelineOpt = { id: string; name: string; stages: { id: string; name: string }[] };
type Def = { schemaVersion: number; trigger: { type: "form.submitted"; formId: string | null }; steps: Step[] };

function defaultStep(type: StepType, id: string, ctx: { members: Option[]; pipelines: PipelineOpt[] }): Step {
  switch (type) {
    case "create_opportunity": {
      const p = ctx.pipelines[0];
      return { id, type, pipelineId: p?.id ?? "", stageId: p?.stages[0]?.id ?? "", title: "{{contact.displayName}} — web inquiry", valueCents: null };
    }
    case "create_task":
      return { id, type, title: "Follow up with {{contact.firstName}}", assigneeUserId: ctx.members[0]?.id ?? "", dueInMinutes: 60 };
    case "wait":
      return { id, type, seconds: 300 };
    case "branch":
      return { id, type, condition: { kind: "contact_has_phone" }, onTrue: "", onFalse: "" };
    case "send_message":
      return { id, type, channel: "sms", purpose: "transactional", body: "Hi {{contact.firstName}}, thanks for contacting {{business.name}}." };
    case "finish":
      return { id, type };
  }
}

export function WorkflowEditor({
  workflowId,
  initial,
  readOnly,
  members,
  pipelines,
  initialIssues,
}: {
  workflowId: string;
  initial: unknown;
  readOnly: boolean;
  members: Option[];
  pipelines: PipelineOpt[];
  initialIssues: Issue[];
}) {
  const [def, setDef] = useState<Def>(() => structuredClone(initial as Def));
  const [serverIssues, setServerIssues] = useState<Issue[]>(initialIssues);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [newType, setNewType] = useState<StepType>("create_task");

  const localIssues = useMemo(() => {
    const p = parseDefinition(def);
    return p.ok ? validateStructure(p.def) : p.issues;
  }, [def]);

  const update = (i: number, patch: Partial<Step>) => {
    setDirty(true);
    setDef((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? ({ ...s, ...patch } as Step) : s)) }));
  };
  const move = (i: number, dir: -1 | 1) => {
    setDirty(true);
    setDef((d) => {
      const steps = [...d.steps];
      const j = i + dir;
      if (j < 0 || j >= steps.length) return d;
      [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      return { ...d, steps };
    });
  };
  const remove = (i: number) => {
    setDirty(true);
    setDef((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }));
  };
  const add = () => {
    setDirty(true);
    setDef((d) => {
      let n = 1;
      while (d.steps.some((s) => s.id === `${newType}_${n}`)) n++;
      return { ...d, steps: [...d.steps, defaultStep(newType, `${newType}_${n}`, { members, pipelines })] };
    });
  };
  const save = () =>
    start(async () => {
      const r = await saveDraftAction(workflowId, JSON.stringify({ ...def, schemaVersion: SCHEMA_VERSION }));
      setStatus({ ok: r.ok, message: r.message });
      setServerIssues(r.issues);
      if (r.ok) setDirty(false);
    });

  const stepIds = def.steps.map((s) => s.id);
  const taskSteps = def.steps.filter((s) => s.type === "create_task").map((s) => s.id);
  const issues = dirty ? localIssues : serverIssues;
  const dis = readOnly;

  return (
    <div className="space-y-4">
      {readOnly && <p className="text-sm text-ink-3">Read-only: only owners and managers can edit automations.</p>}
      <ol className="space-y-3">
        {def.steps.map((s, i) => (
          <li key={i} className="rounded-md border border-line p-3" data-testid={`step-${s.id}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">{i + 1}</span>
                <Badge tone="brand">{STEP_TYPE_LABELS[s.type]}</Badge>
                <label className="sr-only" htmlFor={`id-${i}`}>Step id</label>
                <input id={`id-${i}`} value={s.id} disabled={dis} onChange={(e) => update(i, { id: e.target.value })} className="w-44 rounded border border-line px-2 py-1 font-mono text-xs" />
              </div>
              {!dis && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>↑</Button>
                  <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === def.steps.length - 1} aria-label={`Move step ${i + 1} down`}>↓</Button>
                  <Button size="sm" variant="danger" onClick={() => remove(i)} aria-label={`Remove step ${i + 1}`}>Remove</Button>
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <L label="Label" id={`name-${i}`}><input id={`name-${i}`} className={inputClass} disabled={dis} value={s.name ?? ""} onChange={(e) => update(i, { name: e.target.value || undefined })} /></L>
              {s.type === "create_opportunity" && (
                <>
                  <L label="Opportunity title" id={`t-${i}`}><input id={`t-${i}`} className={inputClass} disabled={dis} value={s.title} onChange={(e) => update(i, { title: e.target.value })} /></L>
                  <L label="Stage" id={`st-${i}`}>
                    <select id={`st-${i}`} className={inputClass} disabled={dis} value={`${s.pipelineId}|${s.stageId}`} onChange={(e) => { const [pipelineId, stageId] = e.target.value.split("|"); update(i, { pipelineId, stageId }); }}>
                      {pipelines.flatMap((p) => p.stages.map((st) => <option key={st.id} value={`${p.id}|${st.id}`}>{p.name} → {st.name}</option>))}
                    </select>
                  </L>
                </>
              )}
              {s.type === "create_task" && (
                <>
                  <L label="Task title" id={`t-${i}`}><input id={`t-${i}`} className={inputClass} disabled={dis} value={s.title} onChange={(e) => update(i, { title: e.target.value })} /></L>
                  <L label="Assignee" id={`a-${i}`}>
                    <select id={`a-${i}`} className={inputClass} disabled={dis} value={s.assigneeUserId} onChange={(e) => update(i, { assigneeUserId: e.target.value })}>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </L>
                  <L label="Due after (minutes)" id={`d-${i}`}><input id={`d-${i}`} type="number" min={0} className={inputClass} disabled={dis} value={s.dueInMinutes} onChange={(e) => update(i, { dueInMinutes: Number(e.target.value) })} /></L>
                  <L label="Description" id={`desc-${i}`}><input id={`desc-${i}`} className={inputClass} disabled={dis} value={s.description ?? ""} onChange={(e) => update(i, { description: e.target.value || undefined })} /></L>
                </>
              )}
              {s.type === "wait" && (
                <L label="Wait (seconds)" id={`w-${i}`} hint="Timers are stored in the database and survive worker restarts."><input id={`w-${i}`} type="number" min={1} className={inputClass} disabled={dis} value={s.seconds} onChange={(e) => update(i, { seconds: Number(e.target.value) })} /></L>
              )}
              {s.type === "send_message" && (
                <>
                  <L label="Channel" id={`c-${i}`}>
                    <select id={`c-${i}`} className={inputClass} disabled={dis} value={s.channel} onChange={(e) => update(i, { channel: e.target.value as "sms" | "email" })}>
                      <option value="sms">SMS (local simulation)</option>
                      <option value="email">Email (local simulation)</option>
                    </select>
                  </L>
                  <L label="Purpose" id={`p-${i}`} hint="Marketing sends require Milestone 2 consent and suppression controls."><input id={`p-${i}`} className={inputClass} disabled value="Transactional acknowledgment" readOnly /></L>
                  <div className="sm:col-span-2"><L label="Message" id={`b-${i}`}><textarea id={`b-${i}`} rows={2} className={inputClass} disabled={dis} value={s.body} onChange={(e) => update(i, { body: e.target.value })} /></L></div>
                </>
              )}
              {s.type === "branch" && (
                <>
                  <L label="Condition" id={`k-${i}`}>
                    <select id={`k-${i}`} className={inputClass} disabled={dis} value={s.condition.kind} onChange={(e) => update(i, { condition: e.target.value === "task_completed" ? { kind: "task_completed", taskStepId: taskSteps[0] ?? "" } : { kind: e.target.value as "contact_has_phone" } })}>
                      <option value="task_completed">A task from an earlier step is completed</option>
                      <option value="contact_has_phone">Contact has a phone number</option>
                      <option value="contact_has_email">Contact has an email address</option>
                    </select>
                  </L>
                  {s.condition.kind === "task_completed" && (
                    <L label="Task step" id={`ts-${i}`}>
                      <select id={`ts-${i}`} className={inputClass} disabled={dis} value={s.condition.taskStepId} onChange={(e) => update(i, { condition: { kind: "task_completed", taskStepId: e.target.value } })}>
                        {taskSteps.map((id) => <option key={id} value={id}>{id}</option>)}
                      </select>
                    </L>
                  )}
                  <L label="If true, go to" id={`yt-${i}`}><StepSelect id={`yt-${i}`} ids={stepIds} value={s.onTrue} disabled={dis} onChange={(v) => update(i, { onTrue: v })} /></L>
                  <L label="If false, go to" id={`yf-${i}`}><StepSelect id={`yf-${i}`} ids={stepIds} value={s.onFalse} disabled={dis} onChange={(v) => update(i, { onFalse: v })} /></L>
                </>
              )}
              {s.type !== "branch" && s.type !== "finish" && (
                <L label="Then" id={`n-${i}`}>
                  <select id={`n-${i}`} className={inputClass} disabled={dis} value={s.next === undefined ? "__next" : s.next === null ? "__end" : s.next} onChange={(e) => update(i, { next: e.target.value === "__next" ? undefined : e.target.value === "__end" ? null : e.target.value })}>
                    <option value="__next">Continue to the next step in the list</option>
                    <option value="__end">End the run</option>
                    {stepIds.filter((x) => x !== s.id).map((x) => <option key={x} value={x}>Go to {x}</option>)}
                  </select>
                </L>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!dis && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="new-step" className="block text-xs font-medium text-ink-2">Add step</label>
            <select id="new-step" value={newType} onChange={(e) => setNewType(e.target.value as StepType)} className="rounded-md border border-line px-2 py-2 text-sm">
              {(Object.keys(STEP_TYPE_LABELS) as StepType[]).map((t) => <option key={t} value={t}>{STEP_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <Button onClick={add}>Add</Button>
          <span className="text-xs text-ink-3">Webhook, approval and AI steps are not available in Milestone 1.</span>
        </div>
      )}
      <p className="text-xs text-ink-3">Template variables: {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ")}</p>
      <div aria-live="polite">
        {issues.length > 0 ? (
          <div className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="draft-issues">
            <p className="font-medium">{issues.length} issue(s) block publishing{dirty ? " (unsaved changes)" : ""}:</p>
            <ul className="list-disc pl-5">{issues.map((x, k) => <li key={k}>{x.message}</li>)}</ul>
          </div>
        ) : (
          <p className="text-sm text-ok">No validation issues{dirty ? " in your unsaved changes" : ""}.</p>
        )}
      </div>
      {!dis && (
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={pending || !dirty}>{pending ? "Saving…" : "Save draft"}</Button>
          {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
          {status && <span role={status.ok ? "status" : "alert"} className={status.ok ? "text-sm text-ok" : "text-sm text-danger"}>{status.message}</span>}
        </div>
      )}
    </div>
  );
}

function L({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-ink-2">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

function StepSelect({ id, ids, value, disabled, onChange }: { id: string; ids: string[]; value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <select id={id} className={inputClass} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a step…</option>
      {ids.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  );
}
