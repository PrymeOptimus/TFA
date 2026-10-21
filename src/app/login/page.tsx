import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/today");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Agentic Operations CRM</h1>
          <p className="mt-1 text-sm text-ink-3">Sign in to your business workspace</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6">
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-ink-3">Local prototype with synthetic demo accounts. Accounts are provisioned by an owner; there is no public sign-up.</p>
      </div>
    </main>
  );
}
