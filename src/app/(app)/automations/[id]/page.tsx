import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Notice, PageHeader, RunStatus, fmtDateTime, inputClass } from "@/components/ui";
import { can } from "@/server/authz";
import { NotFoundError } from "@/server/errors";
import { requireActor } from "@/server/session";
import { listMembers, listPipelinesWithStages } from "@/server/services/crm";
import { getWorkflow } from "@/server/services/workflows";
import { publishWorkflowAction, setWorkflowPausedAction } from "../../actions";
import { WorkflowEditor } from "./editor";

export const metadata = { title: "Automation" };

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  let data;
  try {
    data = await getWorkflow(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [members, pipelines] = await Promise.all([listMembers(actor), listPipelinesWithStages(actor)]);
  const w = data.workflow;
  const active = data.versions.find((v) => v.id === w.activeVersionId);
  const canEdit = can(actor, "workflows.edit");
  const canPublish = can(actor, "workflows.publish");
  const canOperate = can(actor, "workflows.operate");
  return (
    <>
      <PageHeader
        title={w.name}
        description={<>Trigger: lead form submitted. Active version: {active ? <Badge tone="brand">v{active.version}</Badge> : "none"} {w.paused && <Badge tone="warn">Paused</Badge>}</>}
        actions={
          canOperate ? (
            <ActionForm action={setWorkflowPausedAction.bind(null, w.id, !w.paused)} label={w.paused ? "Resume automation" : "Pause automation"} variant={w.paused ? "primary" : "danger"} confirm={w.paused ? undefined : "Pause this automation? Runs stop advancing and queued sends are held until you resume."} />
          ) : undefined
        }
      />
      <div className="space-y-6">
        <Card title="Draft (structured editor)">
          <div className="mb-4">
            <Notice tone="brand">Editing the draft does not change anything that is running. Publishing creates a new immutable version; runs already started keep following the version they began with.</Notice>
          </div>
          <WorkflowEditor
            workflowId={w.id}
            initial={w.draftDefinition}
            readOnly={!canEdit}
            members={members.filter((m) => m.role !== "read_only").map((m) => ({ id: m.userId, label: `${m.name} (${m.role.replace("_", " ")})` }))}
            pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) }))}
            initialIssues={data.draftIssues}
          />
        </Card>

        <Card title="Publish">
          {!canPublish ? (
            <p className="text-sm text-ink-3">Only owners and managers can publish automations.</p>
          ) : data.draftMatchesActive ? (
            <p className="text-sm text-ink-3">The saved draft is identical to the active version (v{active?.version}). Save a change to the draft to publish a new version.</p>
          ) : data.draftIssues.length ? (
            <p className="text-sm text-danger">Fix {data.draftIssues.length} validation issue(s) in the saved draft before publishing.</p>
          ) : (
            <ActionForm action={publishWorkflowAction.bind(null, w.id)} label={`Publish v${(data.versions[0]?.version ?? 0) + 1}`} variant="primary">
              <label htmlFor="changeSummary" className="text-sm font-medium text-ink-2">Change summary (required, kept in version history)</label>
              <input id="changeSummary" name="changeSummary" required minLength={3} maxLength={500} className={inputClass} placeholder="e.g. Escalate after 10 minutes instead of 2" />
            </ActionForm>
          )}
        </Card>

        <Card title="Version history (immutable)">
          <p className="mb-3 text-xs text-ink-3">Configuration history is retained for at least {w.versionRetentionDays} days under the tenant retention policy. Published definitions cannot be edited or deleted.</p>
          {data.versions.length === 0 ? <EmptyState title="Never published" /> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3"><tr><th className="pb-2 font-medium">Version</th><th className="pb-2 font-medium">Published</th><th className="pb-2 font-medium">By</th><th className="pb-2 font-medium">Summary</th><th className="pb-2 font-medium">Content hash</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.versions.map((v) => (
                  <tr key={v.id} data-testid="version-row">
                    <td className="py-2">v{v.version} {v.id === w.activeVersionId && <Badge tone="brand">active</Badge>}</td>
                    <td className="py-2 text-ink-3">{fmtDateTime(v.publishedAt)}</td>
                    <td className="py-2">{v.publishedByName ?? v.publishedByUserId}</td>
                    <td className="py-2">{v.changeSummary}</td>
                    <td className="py-2"><code className="text-[11px] text-ink-3" title={v.contentHash}>{v.contentHash.slice(0, 19)}…</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Runs">
          {data.runs.length === 0 ? <EmptyState title="No runs yet" /> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3"><tr><th className="pb-2 font-medium">Started</th><th className="pb-2 font-medium">Contact</th><th className="pb-2 font-medium">Pinned version</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Step</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2"><Link className="text-brand hover:underline" href={`/automations/runs/${r.id}`}>{fmtDateTime(r.createdAt)}</Link></td>
                    <td className="py-2">{r.contactName ?? "—"}</td>
                    <td className="py-2"><Badge>v{r.version}</Badge></td>
                    <td className="py-2"><RunStatus status={r.status} /></td>
                    <td className="py-2 text-xs text-ink-3">{r.currentStepId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
