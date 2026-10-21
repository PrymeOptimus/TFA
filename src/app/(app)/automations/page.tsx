import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, RunStatus, fmtDateTime } from "@/components/ui";
import { requireActor } from "@/server/session";
import { listRecentRuns, listWorkflows } from "@/server/services/workflows";

export const metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const actor = await requireActor();
  const [wfs, runs] = await Promise.all([listWorkflows(actor), listRecentRuns(actor)]);
  return (
    <>
      <PageHeader title="Automations" description="Each run is pinned to the exact published version it started on. Publishing a new version never changes runs already in progress." />
      <div className="space-y-6">
        <Card title="Workflows">
          {wfs.length === 0 ? <EmptyState title="No automations" /> : (
            <ul className="divide-y divide-line">
              {wfs.map((w) => (
                <li key={w.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link href={`/automations/${w.id}`} className="font-medium text-brand hover:underline">{w.name}</Link>
                    <div className="text-xs text-ink-3">Trigger: lead form submitted · {w.versionCount} published version(s)</div>
                  </div>
                  <div className="flex gap-2">
                    {w.activeVersion ? <Badge tone="brand">Active v{w.activeVersion}</Badge> : <Badge>Not published</Badge>}
                    {w.paused && <Badge tone="warn">Paused</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent runs">
          {runs.length === 0 ? <EmptyState title="No runs yet">Submit the lead form to start one.</EmptyState> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3"><tr><th className="pb-2 font-medium">Started</th><th className="pb-2 font-medium">Workflow</th><th className="pb-2 font-medium">Contact</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Current step</th></tr></thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => (
                  <tr key={r.id} data-testid="run-row">
                    <td className="py-2"><Link className="text-brand hover:underline" href={`/automations/runs/${r.id}`}>{fmtDateTime(r.createdAt)}</Link></td>
                    <td className="py-2">{r.workflowName} <Badge>v{r.version}</Badge></td>
                    <td className="py-2">{r.contactName ?? "—"}</td>
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
