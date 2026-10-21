import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, PageHeader, fmtMoney } from "@/components/ui";
import { can } from "@/server/authz";
import { requireActor } from "@/server/session";
import { getPipelineBoard } from "@/server/services/crm";
import { moveOpportunityAction } from "../actions";

export const metadata = { title: "Pipelines" };

export default async function PipelinesPage() {
  const actor = await requireActor();
  const board = await getPipelineBoard(actor);
  if (!board) return <EmptyState title="No pipeline configured" />;
  const canMove = can(actor, "opportunities.write");
  return (
    <>
      <PageHeader title={board.pipeline.name} description="Stage changes are recorded on the contact timeline and audit log. Values are estimates, not collected revenue. Multiple pipelines arrive with pipeline settings in Milestone 2." />
      <div className="grid gap-4 overflow-x-auto pb-2 md:grid-cols-5">
        {board.stages.map((s) => {
          const opps = board.opportunities.filter((o) => o.stageId === s.id);
          const total = opps.reduce((a, o) => a + (o.valueCents ?? 0), 0);
          return (
            <Card key={s.id} title={`${s.name} (${opps.length})`} className="min-w-56">
              <p className="mb-3 text-xs text-ink-3">Est. {fmtMoney(total)}</p>
              {opps.length === 0 ? (
                <p className="text-xs text-ink-3">Empty</p>
              ) : (
                <ul className="space-y-2">
                  {opps.map((o) => (
                    <li key={o.id} className="rounded-md border border-line p-2 text-sm" data-testid="opportunity-card">
                      <Link href={`/contacts/${o.contactId}`} className="font-medium hover:underline">{o.name}</Link>
                      <div className="text-xs text-ink-3">{fmtMoney(o.valueCents, o.currency)}</div>
                      {canMove && (
                        <ActionForm action={moveOpportunityAction.bind(null, o.id)} label="Move" size="sm" className="mt-2 flex-row! items-center">
                          <label className="sr-only" htmlFor={`stage-${o.id}`}>Stage for {o.name}</label>
                          <select id={`stage-${o.id}`} name="stageId" defaultValue={s.id} className="rounded border border-line px-1 py-0.5 text-xs">
                            {board.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
