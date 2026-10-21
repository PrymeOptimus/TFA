import { ROLE_LABELS } from "@/server/authz";
import { getMemberships, requireActor } from "@/server/session";
import { getTenantSummary } from "@/server/services/crm";
import { Nav } from "./nav";
import { SignOutButton } from "./sign-out";
import { switchTenantAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const [memberships, tenant] = await Promise.all([getMemberships(actor.userId), getTenantSummary(actor)]);
  return (
    <div className="min-h-screen">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="border-b border-sim/20 bg-sim-soft px-4 py-1.5 text-center text-xs text-sim" role="note">
        <strong>Local prototype · synthetic data only.</strong> Messaging uses the <strong>local simulation adapter</strong> — no real SMS or email is sent. Do not enter real patient or client information.
      </div>
      {tenant.sendingPaused && (
        <div className="bg-warn-soft px-4 py-1.5 text-center text-xs text-warn" role="status">
          Outbound sending is paused for {tenant.name}: {tenant.sendingPausedReason}. Queued messages are held.
        </div>
      )}
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
          <div className="px-4 py-4">
            <div className="text-sm font-semibold tracking-tight text-ink">Agentic Operations</div>
            <div className="text-xs text-ink-3">CRM · Milestone 1</div>
          </div>
          <Nav />
          <div className="mt-auto space-y-3 border-t border-line p-4 text-xs">
            <form action={switchTenantAction} className="space-y-1">
              <label htmlFor="tenant-switch" className="block font-medium text-ink-2">Business</label>
              <select id="tenant-switch" name="tenantId" defaultValue={actor.tenantId} className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs">
                {memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>{m.tenantName}</option>
                ))}
              </select>
              {memberships.length > 1 && <button type="submit" className="text-brand underline">Switch business</button>}
            </form>
            <div>
              <div className="font-medium text-ink">{actor.name}</div>
              <div className="text-ink-3">{ROLE_LABELS[actor.role]}</div>
            </div>
            <SignOutButton />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2 md:hidden">
            <span className="text-sm font-semibold">Agentic Operations CRM</span>
            <SignOutButton />
          </header>
          <div className="md:hidden"><Nav compact /></div>
          <main id="main" className="mx-auto max-w-6xl px-4 py-6 md:px-8">
            <p className="mb-4 text-xs font-medium uppercase tracking-wide text-ink-3" data-testid="active-tenant">{tenant.name}</p>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
