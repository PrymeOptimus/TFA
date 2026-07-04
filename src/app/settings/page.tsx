import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsForm } from "@/app/settings/SettingsForm";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const membership = await prisma.householdMember.findFirst({
    where: { userId },
    include: { household: { include: { weatherSettings: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-hearth-bg p-6 sm:p-10">
      <div className="mx-auto max-w-lg">
        <h1 className="font-display text-2xl font-bold">Settings</h1>
        <p className="mb-6 text-sm text-hearth-muted">Account, timezone, and weather location.</p>
        <SettingsForm
          householdId={membership.household.id}
          householdName={membership.household.name}
          timezone={membership.household.timezone}
          locationName={membership.household.weatherSettings?.locationName ?? ""}
          units={membership.household.weatherSettings?.units ?? "imperial"}
          userEmail={session?.user?.email ?? ""}
        />
      </div>
    </main>
  );
}
