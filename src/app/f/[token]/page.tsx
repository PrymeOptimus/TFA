import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { resolvePublicForm } from "@/server/services/ingest";
import { PublicLeadForm } from "./public-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact us", robots: { index: false } };

export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const form = await resolvePublicForm(token);
  if (!form || !form.active) notFound();
  const attribution: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) if (sp[k]) attribution[k] = String(sp[k]).slice(0, 300);
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="rounded-lg border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold">{form.tenantName}</h1>
        <p className="mt-1 mb-6 text-sm text-ink-3">Tell us how we can help and a team member will follow up.</p>
        <PublicLeadForm token={token} submissionId={randomUUID()} attribution={attribution} smsConsentText={form.smsConsentText} marketingConsentText={form.marketingConsentText} />
      </div>
      <p className="mt-3 text-center text-xs text-ink-3">Demo form · synthetic data only · please do not enter real health information.</p>
    </main>
  );
}
