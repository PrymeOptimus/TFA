import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, MessageStatus, PageHeader, cx, fmtDateTime, inputClass } from "@/components/ui";
import { can } from "@/server/authz";
import { requireActor } from "@/server/session";
import { getConversation, listConversations } from "@/server/services/crm";
import { isUuid } from "@/server/util";
import { addNoteAction } from "../actions";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const list = await listConversations(actor);
  const selectedId = sp.c && isUuid(sp.c) ? sp.c : list[0]?.id;
  const conv = selectedId ? await getConversation(actor, selectedId).catch(() => null) : null;
  return (
    <>
      <PageHeader title="Inbox" description="Shared conversations per contact. Unanswered inquiries stay flagged until someone logs a reply." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Conversations" className="lg:col-span-1">
          {list.length === 0 ? (
            <EmptyState title="No conversations yet" />
          ) : (
            <ul className="-mx-2 space-y-0.5">
              {list.map((c) => (
                <li key={c.id}>
                  <Link href={`/inbox?c=${c.id}`} aria-current={c.id === selectedId ? "true" : undefined} className={cx("flex items-center justify-between rounded-md px-2 py-2 text-sm", c.id === selectedId ? "bg-brand-soft" : "hover:bg-slate-50")}>
                    <span>
                      <span className="font-medium">{c.contactName}</span>
                      <span className="block text-xs text-ink-3">{fmtDateTime(c.lastActivityAt)}</span>
                    </span>
                    {c.unanswered && <Badge tone="warn">Unanswered</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="lg:col-span-2">
          {!conv ? (
            <Card><EmptyState title="Select a conversation" /></Card>
          ) : (
            <Card title={<Link href={`/contacts/${conv.contact.id}`} className="hover:underline">{conv.contact.displayName}</Link>} actions={conv.conversation.unanswered ? <Badge tone="warn">Unanswered</Badge> : <Badge tone="ok">Answered</Badge>}>
              <ol className="space-y-3" data-testid="conversation">
                {conv.messages.map((m) => (
                  <li key={m.id} className={cx("max-w-[85%] rounded-lg px-3 py-2 text-sm", m.direction === "outbound" ? "ml-auto bg-brand-soft" : m.direction === "note" ? "mx-auto border border-dashed border-warn/40 bg-warn-soft/40" : "bg-canvas")}>
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                      <span>{m.direction === "note" ? `Internal note · ${m.authorName ?? ""}` : m.direction === "inbound" ? `Inbound · ${m.channel}` : `Outbound · ${m.channel.toUpperCase()}${m.workflowRunId ? " · automation" : ""}`}</span>
                      <span>{fmtDateTime(m.createdAt)}</span>
                      {m.direction === "outbound" && <MessageStatus status={m.status} simulated={m.simulated} />}
                    </div>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    {m.direction === "outbound" && m.statusReason && <p className="mt-1 text-xs text-ink-3">{m.statusReason}</p>}
                  </li>
                ))}
              </ol>
              <div className="mt-6 space-y-3 border-t border-line pt-4">
                {can(actor, "notes.write") ? (
                  <ActionForm action={addNoteAction.bind(null, conv.conversation.id)} label="Add internal note" variant="primary" className="w-full">
                    <label htmlFor="note" className="text-sm font-medium text-ink-2">Internal note (visible to your team only)</label>
                    <textarea id="note" name="body" rows={3} required maxLength={2000} className={inputClass} placeholder="e.g. Called and left a voicemail" />
                    <label className="flex items-center gap-2 text-sm text-ink-2">
                      <input type="checkbox" name="markAnswered" /> This responds to the inquiry (clear “Unanswered”)
                    </label>
                  </ActionForm>
                ) : (
                  <p className="text-sm text-ink-3">Your role cannot add notes.</p>
                )}
                <div className="flex items-center gap-2">
                  <button type="button" disabled className="cursor-not-allowed rounded-md border border-line px-3 py-2 text-sm text-slate-400" aria-describedby="reply-disabled">Send SMS / email reply</button>
                  <span id="reply-disabled" className="text-xs text-ink-3">Manual outbound replies arrive in Milestone 2 with a real provider, consent re-check and delivery callbacks. Log calls as notes for now.</span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
