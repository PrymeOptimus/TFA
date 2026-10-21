import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, MessageStatus, Notice, PageHeader, RunStatus, fmtDateTime, inputClass } from "@/components/ui";
import { can } from "@/server/authz";
import { NotFoundError } from "@/server/errors";
import { requireActor } from "@/server/session";
import { getRun } from "@/server/services/workflows";
import { STEP_TYPE_LABELS } from "@/server/workflow/definition";
import { retryRunAction, skipStepAction } from "../../../actions";

export const metadata = { title: "Automation run" };

const ATTEMPT_TONE: Record<string, "ok" | "brand" | "warn" | "danger" | "neutral"> = {
  succeeded: "ok",
  waiting: "brand",
  failed_retryable: "warn",
  failed_permanent: "danger",
  needs_review: "danger",
  skipped: "warn",
};

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const actor = await requireActor();
  let d;
  try {
    d = await getRun(actor, runId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const r = d.run;
  const failed = r.status === "failed" || r.status === "needs_review";
  const msg = d.messages[0];
  return (
    <>
      <PageHeader
        title={`Run of “${d.workflowName}”`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <RunStatus status={r.status} /> <Badge tone="brand">Pinned to v{d.version.version}</Badge>
            <code className="text-[11px]" title={d.version.contentHash}>{d.version.contentHash.slice(0, 19)}…</code>
            {r.contactId && <Link className="text-brand underline" href={`/contacts/${r.contactId}`}>{d.contactName}</Link>}
          </span>
        }
      />
      <div className="space-y-6">
        {d.workflowPaused && <Notice tone="warn">This automation is paused: the run will not advance and queued sends are held until it is resumed.</Notice>}
        {r.status === "waiting" && (
          <Notice tone="brand">
            Waiting {r.waitReason === "timer" ? `on a durable timer until ${fmtDateTime(r.wakeAt)}` : "for the outbox dispatcher to report the send outcome"}. The timer is stored in the database, so restarting the worker does not lose it.
          </Notice>
        )}
        {failed && (
          <Card title="Needs attention">
            <p className="mb-3 text-sm text-danger">{r.error}</p>
            {can(actor, "workflows.operate") ? (
              <div className="flex flex-wrap gap-6">
                <ActionForm action={retryRunAction.bind(null, r.id)} label="Retry failed step" variant="primary">
                  <p className="max-w-sm text-xs text-ink-3">Completed steps (opportunity, tasks) are not repeated. A failed send is re-queued and dispatch policy is re-checked.</p>
                  {msg?.status === "unknown" && (
                    <label className="flex items-center gap-2 text-xs text-danger"><input type="checkbox" name="ack" /> I understand the earlier send may have gone out; retrying may duplicate it.</label>
                  )}
                </ActionForm>
                <ActionForm action={skipStepAction.bind(null, r.id)} label="Skip step and continue" confirm="Skip this step? The run continues with the next step.">
                  <label htmlFor="reason" className="text-xs font-medium text-ink-2">Reason (recorded in the audit trail)</label>
                  <input id="reason" name="reason" required minLength={3} className={inputClass} placeholder="e.g. Called the contact directly instead" />
                </ActionForm>
              </div>
            ) : (
              <p className="text-sm text-ink-3">An owner or manager can retry or skip this step.</p>
            )}
          </Card>
        )}

        <Card title="Steps (pinned definition)">
          {!d.definition ? <EmptyState title="Definition unavailable" /> : (
            <ol className="space-y-3">
              {d.definition.steps.map((s, i) => {
                const attempts = d.attempts.filter((a) => a.stepId === s.id);
                const effect = d.effects.find((e) => e.stepId === s.id);
                const current = r.currentStepId === s.id;
                return (
                  <li key={s.id} className={`rounded-md border p-3 ${current ? "border-brand" : "border-line"}`} data-testid={`run-step-${s.id}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{i + 1}. {s.name ?? s.id}</span>
                      <Badge>{STEP_TYPE_LABELS[s.type]}</Badge>
                      {current && <Badge tone="brand">current</Badge>}
                      {effect && <Badge tone={effect.state === "completed" ? "ok" : "neutral"}>effect {effect.state}</Badge>}
                    </div>
                    {attempts.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-ink-2">
                        {attempts.map((a) => (
                          <li key={a.id} className="flex flex-wrap gap-2">
                            <Badge tone={ATTEMPT_TONE[a.status] ?? "neutral"}>{a.status.replace("_", " ")}</Badge>
                            <span>attempt {a.attempt}</span>
                            <span className="text-ink-3">{fmtDateTime(a.finishedAt)}</span>
                            <span className="text-ink-3">worker {a.workerId}</span>
                            {a.error && <span className="text-danger">{a.error}</span>}
                            {a.retryAt && <span>retry at {fmtDateTime(a.retryAt)}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-ink-3">Not executed{r.status === "completed" ? " (not on this run's path)" : " yet"}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        {msg && (
          <Card title="Acknowledgment message — delivery evidence">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <MessageStatus status={msg.status} simulated={msg.simulated} />
              <span className="text-ink-3">{msg.channel.toUpperCase()} · provider {msg.provider ?? "—"} · id {msg.providerMessageId ?? "—"}</span>
            </div>
            <p className="mb-3 text-xs text-ink-3">“Provider accepted” means the adapter accepted the request. It is not proof of delivery to a person. The local simulator never reports delivery.</p>
            <ul className="space-y-1 text-xs">
              {d.messageEvents.map((e) => (
                <li key={e.id} className="flex gap-2"><span className="text-ink-3">{fmtDateTime(e.occurredAt)}</span><code>{e.status}</code><span className="text-ink-2">{String((e.detail as Record<string, unknown>).reason ?? (e.detail as Record<string, unknown>).error ?? "")}</span></li>
              ))}
            </ul>
            {d.outbox[0] && <p className="mt-2 text-xs text-ink-3">Outbox: {d.outbox[0].status} · {d.outbox[0].attempts}/{d.outbox[0].maxAttempts} attempts{d.outbox[0].lastError ? ` · last error: ${d.outbox[0].lastError}` : ""}</p>}
          </Card>
        )}

        <Card title="Identifiers">
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <dt className="text-ink-3">Run id</dt><dd><code>{r.id}</code></dd>
            <dt className="text-ink-3">Version id</dt><dd><code>{r.workflowVersionId}</code></dd>
            <dt className="text-ink-3">Correlation id</dt><dd><code>{r.correlationId}</code></dd>
            <dt className="text-ink-3">Trigger event</dt><dd><code>{r.triggerInboxEventId}</code></dd>
            <dt className="text-ink-3">Started</dt><dd>{fmtDateTime(r.createdAt)}</dd>
            <dt className="text-ink-3">Completed</dt><dd>{fmtDateTime(r.completedAt)}</dd>
          </dl>
          <p className="mt-3 text-xs text-ink-3">There is no “replay” control in Milestone 1: re-running business actions and deterministic replay are different operations and will be offered separately, with side-effect-free simulation, in Milestone 2.</p>
        </Card>
      </div>
    </>
  );
}
