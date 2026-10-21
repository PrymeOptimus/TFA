import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, LinkButton, PageHeader, fmtDateTime, type Tone } from "@/components/ui";
import { requireActor } from "@/server/session";
import { getToday, type TodayRow } from "@/server/services/crm";
import { completeTaskAction } from "../actions";

export const metadata = { title: "Today" };

const KIND: Record<TodayRow["kind"], { label: string; tone: Tone }> = {
  overdue_task: { label: "Overdue", tone: "danger" },
  due_task: { label: "Open task", tone: "neutral" },
  unanswered: { label: "Unanswered", tone: "warn" },
  failed_automation: { label: "Automation issue", tone: "danger" },
};

function NextAction({ r }: { r: TodayRow }) {
  return r.action.type === "complete_task" ? (
    <ActionForm
      action={completeTaskAction.bind(null, r.action.taskId)}
      label="Complete"
      pendingLabel="Saving…"
      size="sm"
      variant="primary"
      disabled={!r.action.allowed}
      disabledReason="Only the assignee or a manager can complete this"
    />
  ) : (
    <LinkButton href={r.action.href} size="sm">{r.action.label}</LinkButton>
  );
}

function Rows({ rows, empty }: { rows: TodayRow[]; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <>
    <ul className="space-y-3 md:hidden">
      {rows.map((r) => (
        <li key={`m-${r.kind}-${r.id}`} className="rounded-md border border-line p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge>
              <div className="mt-1 font-medium">{r.title}</div>
            </div>
            <NextAction r={r} />
          </div>
          <div className="mt-1 text-xs text-ink-3">
            {r.reason} · {r.ownerName ?? "Unassigned"} · <Link className="text-brand underline" href={r.recordHref}>{r.recordLabel}</Link>
          </div>
        </li>
      ))}
    </ul>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-3">
          <tr>
            <th scope="col" className="pb-2 font-medium">Item</th>
            <th scope="col" className="pb-2 font-medium">Why it is here</th>
            <th scope="col" className="pb-2 font-medium">Owner</th>
            <th scope="col" className="pb-2 font-medium">Record</th>
            <th scope="col" className="pb-2 text-right font-medium">Next action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={`${r.kind}-${r.id}`} data-testid={`today-${r.kind}`}>
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-2">
                  <Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge>
                  <span className="font-medium text-ink">{r.title}</span>
                </div>
              </td>
              <td className="py-2.5 pr-3 text-ink-2">
                {r.reason}
                {r.at && <div className="text-xs text-ink-3">{fmtDateTime(r.at)}</div>}
              </td>
              <td className="py-2.5 pr-3 text-ink-2">{r.ownerName ?? <span className="text-ink-3">Unassigned</span>}</td>
              <td className="py-2.5 pr-3"><Link className="text-brand underline-offset-2 hover:underline" href={r.recordHref}>{r.recordLabel}</Link></td>
              <td className="py-2.5 text-right"><NextAction r={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

export default async function TodayPage() {
  const actor = await requireActor();
  const t = await getToday(actor);
  return (
    <>
      <PageHeader
        title="Today"
        description={`${t.scope === "mine" ? "Your work and unassigned work" : "All team work"}, ordered by urgency. Generated ${fmtDateTime(t.generatedAt)} (America/New_York).`}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Overdue tasks", t.overdue.length, "danger"],
          ["Open tasks", t.due.length, "neutral"],
          ["Unanswered inquiries", t.unanswered.length, "warn"],
          ["Automation issues", t.failed.length, "danger"],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-lg border border-line bg-surface px-4 py-3">
            <div className="text-2xl font-semibold">{n as number}</div>
            <div className="text-xs text-ink-3">{label as string}</div>
          </div>
        ))}
      </div>
      <div className="space-y-6">
        <Card title="Overdue"><Rows rows={t.overdue} empty="Nothing overdue" /></Card>
        <Card title="Unanswered inquiries"><Rows rows={t.unanswered} empty="Every inquiry has a logged reply" /></Card>
        {t.failed.length > 0 || actor.role === "owner" || actor.role === "manager" ? (
          <Card title="Failed automations — review queue"><Rows rows={t.failed} empty="No failed or stuck automation runs" /></Card>
        ) : null}
        <Card title="Open tasks"><Rows rows={t.due} empty="No open tasks" /></Card>
      </div>
    </>
  );
}
