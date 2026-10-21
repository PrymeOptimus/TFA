import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, PageHeader, fmtDateTime, inputClass } from "@/components/ui";
import { can } from "@/server/authz";
import { requireActor } from "@/server/session";
import { listContacts } from "@/server/services/crm";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const { rows, total, page, pageSize } = await listContacts(actor, { q: sp.q, page: Number(sp.page ?? 1) });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (p: number) => `/contacts?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`;
  return (
    <>
      <PageHeader
        title="Contacts"
        description={rows[0]?.masked ? "Email and phone are masked for your role." : undefined}
        actions={can(actor, "contacts.write") ? <LinkButton href="/contacts/new" variant="primary">New contact</LinkButton> : undefined}
      />
      <Card>
        <form className="mb-4 flex gap-2" role="search">
          <label htmlFor="q" className="sr-only">Search contacts</label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="Search name, email or phone" className={inputClass} />
          <button className="rounded-md border border-line px-3 text-sm">Search</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title={sp.q ? "No contacts match your search" : "No contacts yet"}>Submissions from your lead form appear here automatically.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3">
                <tr>
                  <th scope="col" className="pb-2 font-medium">Name</th>
                  <th scope="col" className="pb-2 font-medium">Email</th>
                  <th scope="col" className="pb-2 font-medium">Phone</th>
                  <th scope="col" className="pb-2 font-medium">Source</th>
                  <th scope="col" className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2"><Link href={`/contacts/${c.id}`} className="font-medium text-brand hover:underline">{c.displayName}</Link></td>
                    <td className="py-2 text-ink-2">{c.email ?? "—"}</td>
                    <td className="py-2 text-ink-2">{c.phone ?? "—"}</td>
                    <td className="py-2"><Badge>{c.source.replace("_", " ")}</Badge></td>
                    <td className="py-2 text-ink-3">{fmtDateTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm text-ink-3">
          <span>{total} contact{total === 1 ? "" : "s"} · page {page} of {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="underline" href={qs(page - 1)}>Previous</Link>}
            {page < pages && <Link className="underline" href={qs(page + 1)}>Next</Link>}
          </span>
        </nav>
      </Card>
    </>
  );
}
