import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, fmtDateTime, inputClass } from "@/components/ui";
import { ROLES, ROLE_LABELS, can } from "@/server/authz";
import { getSessionUser, requireActor } from "@/server/session";
import { getTenantSummary, listAudit, listMembers } from "@/server/services/crm";
import { listForms } from "@/server/services/settings";
import { changeRoleAction, rotateFormTokenAction, setSendingPausedAction } from "../actions";
import { MfaSettings } from "./mfa";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ auditPage?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const [members, forms, tenant, user] = await Promise.all([listMembers(actor), listForms(actor), getTenantSummary(actor), getSessionUser()]);
  const auditPage = Number(sp.auditPage ?? 1);
  const auditLog = can(actor, "audit.read") ? await listAudit(actor, { page: auditPage }) : null;
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return (
    <>
      <PageHeader title="Settings" description={`Business: ${tenant.name} · timezone ${tenant.timezone}`} />
      <div className="space-y-6">
        <Card title="Team and roles" id="team">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3"><tr><th className="pb-2 font-medium">Name</th><th className="pb-2 font-medium">Email</th><th className="pb-2 font-medium">MFA</th><th className="pb-2 font-medium">Role</th></tr></thead>
            <tbody className="divide-y divide-line">
              {members.map((m) => (
                <tr key={m.userId}>
                  <td className="py-2">{m.name}</td>
                  <td className="py-2 text-ink-2">{m.email}</td>
                  <td className="py-2">{m.mfa ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}</td>
                  <td className="py-2">
                    {can(actor, "members.manage") && m.userId !== actor.userId ? (
                      <ActionForm action={changeRoleAction.bind(null, m.userId)} label="Save" size="sm" className="flex-row! items-center">
                        <label className="sr-only" htmlFor={`role-${m.userId}`}>Role for {m.name}</label>
                        <select id={`role-${m.userId}`} name="role" defaultValue={m.role} className="rounded border border-line px-1 py-0.5 text-xs">
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      </ActionForm>
                    ) : (
                      <Badge>{ROLE_LABELS[m.role]}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-ink-3">Role changes are audited. Inviting members, verified ownership and time-limited support access are planned for Milestone 3.</p>
        </Card>

        <Card title="Lead forms" id="forms">
          <ul className="space-y-4">
            {forms.map((f) => (
              <li key={f.id} className="text-sm">
                <div className="font-medium">{f.name} {f.active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</div>
                <p className="text-xs text-ink-3">Public link token begins with <code>{f.tokenHint}</code>. Only a hash of the token is stored; the token authorizes submissions to this form only.</p>
                {can(actor, "forms.manage") && (
                  <ActionForm action={rotateFormTokenAction.bind(null, f.id)} label="Rotate public link" size="sm" confirm="Rotate the public link? The current link and any embeds using it stop working immediately." className="mt-2" />
                )}
                <p className="mt-2 text-xs text-ink-3">Embed: <code>{`<iframe src="${base}/f/<token>" title="Contact form" style="width:100%;height:720px;border:0"></iframe>`}</code></p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Outbound sending controls" id="sending">
          <p className="mb-3 text-sm text-ink-2">
            Status: {tenant.sendingPaused ? <Badge tone="warn">Paused — {tenant.sendingPausedReason}</Badge> : <Badge tone="ok">Active (local simulation)</Badge>}
          </p>
          {can(actor, "sending.control") ? (
            tenant.sendingPaused ? (
              <ActionForm action={setSendingPausedAction.bind(null, false)} label="Resume sending" variant="primary" />
            ) : (
              <ActionForm action={setSendingPausedAction.bind(null, true)} label="Pause all outbound sending" variant="danger" confirm="Pause all outbound messages for this business?">
                <label htmlFor="pause-reason" className="text-xs font-medium text-ink-2">Reason</label>
                <input id="pause-reason" name="reason" required minLength={3} className={inputClass} placeholder="e.g. Reviewing message wording" />
              </ActionForm>
            )
          ) : (
            <p className="text-xs text-ink-3">Owners and managers can pause sending.</p>
          )}
          <p className="mt-3 text-xs text-ink-3">The kill switch is checked by the dispatcher immediately before each send. Messages already handed to a provider cannot be recalled. Sending windows, budgets and opt-out handling arrive with real providers in Milestone 2.</p>
        </Card>

        <Card title="Your security" id="security">
          <MfaSettings enabled={Boolean((user as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled)} />
        </Card>

        <Card title="Export" id="export">
          {can(actor, "export.data") ? (
            <div className="flex flex-wrap gap-3 text-sm">
              <a className="rounded-md border border-line px-3 py-2 hover:bg-slate-50" href="/api/v1/exports/contacts.csv">Download contacts (CSV)</a>
              <a className="rounded-md border border-line px-3 py-2 hover:bg-slate-50" href="/api/v1/exports/opportunities.csv">Download opportunities (CSV)</a>
            </div>
          ) : (
            <p className="text-sm text-ink-3">Your role cannot export data.</p>
          )}
          <p className="mt-3 text-xs text-ink-3">Exports include only this business, are audited, and neutralize spreadsheet formulas. The complete tenant archive (consent, conversations, workflows, manifest and checksums) is planned for Milestone 3.</p>
        </Card>

        {auditLog && (
          <Card title="Audit log" id="audit">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3"><tr><th className="pb-2 font-medium">When</th><th className="pb-2 font-medium">Actor</th><th className="pb-2 font-medium">Action</th><th className="pb-2 font-medium">Summary</th></tr></thead>
              <tbody className="divide-y divide-line">
                {auditLog.rows.map((e) => (
                  <tr key={e.id}>
                    <td className="py-1.5 text-xs text-ink-3 whitespace-nowrap">{fmtDateTime(e.occurredAt)}</td>
                    <td className="py-1.5 text-xs">{e.actorType}{(e.data as { actorName?: string }).actorName ? `: ${(e.data as { actorName?: string }).actorName}` : ""}</td>
                    <td className="py-1.5"><code className="text-[11px]">{e.action}</code></td>
                    <td className="py-1.5 text-ink-2">{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <nav className="mt-3 flex gap-3 text-sm" aria-label="Audit pagination">
              {auditPage > 1 && <a className="underline" href={`/settings?auditPage=${auditPage - 1}#audit`}>Newer</a>}
              {auditLog.rows.length === 50 && <a className="underline" href={`/settings?auditPage=${auditPage + 1}#audit`}>Older</a>}
            </nav>
            <p className="mt-2 text-xs text-ink-3">The audit log is append-only: the database rejects updates and deletes.</p>
          </Card>
        )}
      </div>
    </>
  );
}
