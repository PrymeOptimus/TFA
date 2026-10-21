import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, MessageStatus, PageHeader, fmtDateTime, fmtMoney } from "@/components/ui";
import { can } from "@/server/authz";
import { NotFoundError } from "@/server/errors";
import { requireActor } from "@/server/session";
import { getContact, getTimeline } from "@/server/services/crm";
import { completeTaskAction } from "../../actions";

export const metadata = { title: "Contact" };

const SOURCE_TONE: Record<string, "brand" | "neutral" | "sim" | "warn"> = { workflow: "brand", user: "neutral", local_provider: "sim", public_form: "warn" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  let data, timeline;
  try {
    [data, timeline] = await Promise.all([getContact(actor, id), getTimeline(actor, id)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const c = data.contact;
  return (
    <>
      <PageHeader
        title={c.displayName}
        description={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Email: {c.email ?? "—"}</span>
            <span>Phone: {c.phone ?? "—"}</span>
            <span>Source: {c.source.replace("_", " ")}</span>
            {c.masked && <Badge tone="warn">Contact details masked for your role</Badge>}
          </span>
        }
        actions={data.conversation ? <Link className="text-sm text-brand underline" href={`/inbox?c=${data.conversation.id}`}>Open conversation</Link> : undefined}
      />
      {data.duplicates.length > 0 && (
        <div className="mb-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn" role="note">
          Possible duplicate:{" "}
          {data.duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <Link className="underline" href={`/contacts/${d.candidateId}`}>{d.candidateName}</Link> ({d.reason})
            </span>
          ))}
          . Shared contact details do not prove identity, so nothing was merged. Reviewed merging with an impact preview is planned for Milestone 2.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Timeline">
            {timeline.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ol className="space-y-4" data-testid="timeline">
                {timeline.map((e) => (
                  <li key={e.id} className="relative border-l-2 border-line pl-4" data-action={e.action}>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                      <time dateTime={new Date(e.at).toISOString()}>{fmtDateTime(e.at)}</time>
                      <Badge tone={SOURCE_TONE[e.actorType] ?? "neutral"}>{e.actorLabel}</Badge>
                      <code className="text-[11px]">{e.action}</code>
                    </div>
                    <p className="mt-0.5 text-sm text-ink">{e.summary}</p>
                    {e.message && (
                      <div className="mt-1.5 rounded-md border border-line bg-canvas px-3 py-2 text-sm">
                        <div className="mb-1 flex items-center gap-2 text-xs text-ink-3">
                          {e.message.direction} · {e.message.channel} <MessageStatus status={e.message.status} simulated={e.message.simulated} />
                        </div>
                        <p className="whitespace-pre-wrap text-ink-2">{e.message.body}</p>
                        {e.message.statusReason && <p className="mt-1 text-xs text-ink-3">{e.message.statusReason}</p>}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Tasks">
            {data.tasks.length === 0 ? (
              <EmptyState title="No tasks" />
            ) : (
              <ul className="space-y-3">
                {data.tasks.map((t) => (
                  <li key={t.id} className="text-sm" data-testid="contact-task">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className={t.status === "completed" ? "text-ink-3 line-through" : "font-medium"}>{t.title}</div>
                        <div className="text-xs text-ink-3">{t.assigneeName ?? "Unassigned"} · due {fmtDateTime(t.dueAt)}</div>
                      </div>
                      {t.status === "open" ? (
                        <ActionForm
                          action={completeTaskAction.bind(null, t.id)}
                          label="Complete"
                          size="sm"
                          variant="primary"
                          disabled={!(can(actor, "tasks.complete_any") || (can(actor, "tasks.complete_own") && t.assigneeUserId === actor.userId))}
                          disabledReason="Assignee or manager only"
                        />
                      ) : (
                        <Badge tone="ok">{t.status}</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Opportunities">
            {data.opportunities.length === 0 ? (
              <EmptyState title="No opportunities" />
            ) : (
              <ul className="space-y-2 text-sm">
                {data.opportunities.map((o) => (
                  <li key={o.id} className="flex justify-between gap-2">
                    <span>{o.name}</span>
                    <span className="text-right text-xs text-ink-3"><Badge>{o.stageName}</Badge><br />est. {fmtMoney(o.valueCents, o.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-3">Estimated value is pipeline value, not collected revenue.</p>
          </Card>
          <Card title="Consent (current)">
            {data.consent.length === 0 ? (
              <EmptyState title="No consent on record">Being in the CRM does not imply consent to be messaged.</EmptyState>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.consent.map((k) => (
                  <li key={`${k.channel}-${k.purpose}`} className="flex justify-between">
                    <span>{k.channel.toUpperCase()} · {k.purpose}</span>
                    <Badge tone={k.action === "granted" ? "ok" : "danger"}>{k.action} via {k.source}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {data.submissions.length > 0 && (
            <Card title="Lead source (recorded)">
              <ul className="space-y-1 text-xs text-ink-2">
                {data.submissions.map((s) => (
                  <li key={s.id}>
                    {fmtDateTime(s.submittedAt)} — {Object.entries(s.attribution).map(([k, v]) => `${k}=${v}`).join(", ") || "no UTM parameters"}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">Source parameters are recorded as reported; they do not prove what caused the inquiry.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
